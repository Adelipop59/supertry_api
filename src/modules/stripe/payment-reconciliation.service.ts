import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from './stripe.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import {
  AuditCategory,
  CampaignStatus,
  NotificationType,
  TransactionStatus,
} from '@prisma/client';

/** Origine de l'appel — tracée en audit pour diagnostiquer webhook vs fallback. */
export type ReconcileSource = 'webhook' | 'endpoint' | 'scheduler';

export interface ReconcileResult {
  /**
   * - authorized: PI autorisé (manual capture) → campagne en PENDING_ACTIVATION, grace period démarrée
   * - activated: PI déjà capturé → campagne ACTIVE, escrow crédité
   * - already_processed: rien à faire (idempotence)
   * - not_paid: la session Checkout n'est pas payée / PI non exploitable
   * - not_found: transaction ou campagne introuvable
   */
  outcome: 'authorized' | 'activated' | 'already_processed' | 'not_paid' | 'not_found';
  campaignId?: string;
  campaignStatus?: CampaignStatus;
  activationGracePeriodEndsAt?: Date | null;
}

/**
 * Réconciliation d'une Checkout Session campagne avec l'état interne.
 *
 * IDEMPOTENT et multi-appelants : la même logique est appelée par
 *  - le webhook `checkout.session.completed` (chemin nominal),
 *  - l'endpoint POST /campaigns/:id/reconcile-payment (retour de Checkout),
 *  - le PaymentCaptureScheduler (filet de sécurité si webhook perdu).
 *
 * Gardes d'idempotence :
 *  - transaction COMPLETED ou paymentCapturedAt posé → no-op (pas de double crédit escrow)
 *  - paymentAuthorizedAt déjà posé → no-op (la grace period n'est JAMAIS prolongée)
 *  - claims atomiques via updateMany(count) pour résister aux appels concurrents (multi-pods)
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  async reconcileCheckoutSession(
    sessionId: string,
    source: ReconcileSource,
  ): Promise<ReconcileResult> {
    // 1. Retrouver la transaction interne (stripeSessionId est @unique)
    const transaction = await this.prisma.transaction.findUnique({
      where: { stripeSessionId: sessionId },
    });

    if (!transaction) {
      this.logger.warn(`[reconcile:${source}] Transaction not found for session ${sessionId}`);
      return { outcome: 'not_found' };
    }
    if (!transaction.campaignId) {
      this.logger.warn(`[reconcile:${source}] Transaction ${transaction.id} has no campaignId`);
      return { outcome: 'not_found' };
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: transaction.campaignId },
    });
    if (!campaign) {
      this.logger.warn(`[reconcile:${source}] Campaign ${transaction.campaignId} not found`);
      return { outcome: 'not_found' };
    }

    // 2. GARDE IDEMPOTENCE GLOBALE — déjà capturé/complété : ne JAMAIS re-créditer l'escrow
    if (
      transaction.status === TransactionStatus.COMPLETED ||
      campaign.paymentCapturedAt !== null ||
      campaign.status === CampaignStatus.ACTIVE
    ) {
      return {
        outcome: 'already_processed',
        campaignId: campaign.id,
        campaignStatus: campaign.status,
        activationGracePeriodEndsAt: campaign.activationGracePeriodEndsAt,
      };
    }

    // 3. Source de vérité : l'état Stripe de la session
    const session = await this.stripeService.getCheckoutSession(sessionId);
    if (session.payment_status !== 'paid') {
      // 'unpaid' / 'no_payment_required' → le PRO n'a pas (encore) payé
      return {
        outcome: 'not_paid',
        campaignId: campaign.id,
        campaignStatus: campaign.status,
      };
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    if (!paymentIntentId) {
      this.logger.warn(`[reconcile:${source}] Session ${sessionId} paid but no PaymentIntent`);
      return { outcome: 'not_paid', campaignId: campaign.id, campaignStatus: campaign.status };
    }

    // Sauvegarder le PI sur la transaction (idempotent — même valeur)
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: { stripePaymentIntentId: paymentIntentId },
    });

    // 4. État réel du PaymentIntent (manual capture → requires_capture)
    let piStatus: string;
    try {
      const pi = await this.stripeService.getPaymentIntent(paymentIntentId);
      piStatus = pi.status;
    } catch {
      this.logger.warn(
        `[reconcile:${source}] Could not retrieve PI ${paymentIntentId}, assuming succeeded`,
      );
      piStatus = 'succeeded';
    }

    if (piStatus === 'requires_capture') {
      return this.markAuthorized(campaign, transaction.id, paymentIntentId, source);
    }
    if (piStatus === 'succeeded') {
      return this.markActivated(campaign, transaction.id, sessionId, paymentIntentId, source);
    }

    // canceled / requires_payment_method / processing… : rien à réconcilier
    this.logger.warn(
      `[reconcile:${source}] PI ${paymentIntentId} in status ${piStatus} — nothing to reconcile`,
    );
    return { outcome: 'not_paid', campaignId: campaign.id, campaignStatus: campaign.status };
  }

  /**
   * MANUAL CAPTURE : paiement autorisé, pas capturé.
   * Campagne → PENDING_ACTIVATION (grace period, invisible aux testeurs, annulation gratuite).
   */
  private async markAuthorized(
    campaign: { id: string; sellerId: string; title: string },
    transactionId: string,
    paymentIntentId: string,
    source: ReconcileSource,
  ): Promise<ReconcileResult> {
    const rules = await this.prisma.businessRules.findFirst({ orderBy: { createdAt: 'desc' } });
    const captureDelayMinutes = rules?.captureDelayMinutes ?? 60;
    const now = new Date();
    const gracePeriodEnd = new Date(now.getTime() + captureDelayMinutes * 60 * 1000);

    // CLAIM ATOMIQUE : seul le premier appelant pose l'autorisation.
    // paymentAuthorizedAt != null → un autre appel (webhook/endpoint/cron/pod) a déjà traité :
    // on ne prolonge JAMAIS la grace period.
    const claimed = await this.prisma.campaign.updateMany({
      where: {
        id: campaign.id,
        paymentAuthorizedAt: null,
        status: { in: [CampaignStatus.PENDING_PAYMENT, CampaignStatus.PENDING_ACTIVATION] },
      },
      data: {
        status: CampaignStatus.PENDING_ACTIVATION,
        stripePaymentIntentId: paymentIntentId,
        paymentAuthorizedAt: now,
        activationGracePeriodEndsAt: gracePeriodEnd,
      },
    });

    if (claimed.count === 0) {
      const current = await this.prisma.campaign.findUnique({ where: { id: campaign.id } });
      return {
        outcome: 'already_processed',
        campaignId: campaign.id,
        campaignStatus: current?.status,
        activationGracePeriodEndsAt: current?.activationGracePeriodEndsAt,
      };
    }

    // Transaction reste PENDING (sera COMPLETED après capture par le scheduler)

    const sellerProfile = await this.prisma.profile.findUnique({
      where: { id: campaign.sellerId },
      select: { email: true, firstName: true },
    });

    if (sellerProfile) {
      this.notificationsService.tryQueueEmail({
        to: sellerProfile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Payment Authorized - Campaign Pending',
        variables: {
          campaignTitle: campaign.title,
          message: `Your payment for "${campaign.title}" has been authorized. You have ${captureDelayMinutes} minutes to cancel for free. After that, the campaign will be activated automatically.`,
        },
        metadata: {
          userId: campaign.sellerId,
          campaignId: campaign.id,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }

    await this.auditService.log(
      campaign.sellerId,
      AuditCategory.CAMPAIGN,
      'CAMPAIGN_PAYMENT_AUTHORIZED',
      {
        campaignId: campaign.id,
        paymentIntentId,
        captureMethod: 'manual',
        gracePeriodMinutes: captureDelayMinutes,
        reconcileSource: source,
      },
    );

    this.logger.log(
      `[reconcile:${source}] Campaign ${campaign.id} authorized (manual capture, grace ends ${gracePeriodEnd.toISOString()})`,
    );

    return {
      outcome: 'authorized',
      campaignId: campaign.id,
      campaignStatus: CampaignStatus.PENDING_ACTIVATION,
      activationGracePeriodEndsAt: gracePeriodEnd,
    };
  }

  /**
   * AUTOMATIC CAPTURE (ou PI déjà capturé) : activation + crédit escrow.
   * Le flip transaction PENDING→COMPLETED sert de verrou d'idempotence :
   * un seul appelant peut créditer l'escrow.
   */
  private async markActivated(
    campaign: { id: string; sellerId: string; title: string },
    transactionId: string,
    sessionId: string,
    paymentIntentId: string,
    source: ReconcileSource,
  ): Promise<ReconcileResult> {
    let credited = false;
    let amount = 0;

    await this.prisma.$transaction(async (tx) => {
      // CLAIM ATOMIQUE : seule la mise à jour PENDING→COMPLETED autorise le crédit escrow
      const flipped = await tx.transaction.updateMany({
        where: { id: transactionId, status: TransactionStatus.PENDING },
        data: { status: TransactionStatus.COMPLETED },
      });

      if (flipped.count === 0) return; // déjà traité par un autre appelant

      const txRow = await tx.transaction.findUnique({ where: { id: transactionId } });
      amount = Number(txRow?.amount ?? 0);

      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          status: CampaignStatus.ACTIVE,
          stripePaymentIntentId: paymentIntentId,
          paymentCapturedAt: new Date(),
        },
      });

      const platformWallet = await tx.platformWallet.findFirst();
      if (platformWallet) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { increment: amount },
            totalReceived: { increment: amount },
          },
        });
      }

      credited = true;
    });

    if (!credited) {
      const current = await this.prisma.campaign.findUnique({ where: { id: campaign.id } });
      return {
        outcome: 'already_processed',
        campaignId: campaign.id,
        campaignStatus: current?.status,
      };
    }

    await this.auditService.log(campaign.sellerId, AuditCategory.CAMPAIGN, 'CAMPAIGN_ACTIVATED', {
      campaignId: campaign.id,
      transactionId,
      sessionId,
      paymentIntentId,
      amount,
      reconcileSource: source,
    });

    const sellerProfile = await this.prisma.profile.findUnique({
      where: { id: campaign.sellerId },
      select: { email: true, firstName: true },
    });

    if (sellerProfile) {
      this.notificationsService.tryQueueEmail({
        to: sellerProfile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Campaign Activated',
        variables: {
          campaignTitle: campaign.title,
          message: `Your campaign "${campaign.title}" has been activated and is now live!`,
        },
        metadata: {
          userId: campaign.sellerId,
          campaignId: campaign.id,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }

    this.logger.log(`[reconcile:${source}] Campaign ${campaign.id} activated (session ${sessionId})`);

    return {
      outcome: 'activated',
      campaignId: campaign.id,
      campaignStatus: CampaignStatus.ACTIVE,
    };
  }
}
