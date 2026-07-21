import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { AuditService } from '../audit/audit.service';
import { AuditCategory, CampaignStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentReconciliationService } from '../stripe/payment-reconciliation.service';

@Injectable()
export class PaymentCaptureScheduler {
  private readonly logger = new Logger(PaymentCaptureScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly auditService: AuditService,
    private readonly paymentReconciliation: PaymentReconciliationService,
  ) {}

  /**
   * CRON toutes les 2 minutes: auto-capture des PI après le délai de grâce (captureDelayMinutes)
   * Le PRO a payé, le PI est en requires_capture. Après 1h (par défaut), on capture automatiquement.
   */
  @Cron(
    process.env.NODE_ENV === 'production' ? '*/2 * * * *' : '*/10 * * * * *',
    {
      name: 'payment-auto-capture',
      timeZone: 'Europe/Paris',
    },
  )
  async handleAutoCapture() {
    // B1 — fallback défensif : ne JAMAIS tuer le cron si business_rules est vide
    // (findLatest() throw BUSINESS_RULES_NOT_FOUND → plus aucune capture/activation).
    const rules = await this.prisma.businessRules.findFirst({ orderBy: { createdAt: 'desc' } });
    const captureDelayMinutes = rules?.captureDelayMinutes ?? 60;
    if (!rules) {
      this.logger.warn('[AUTO-CAPTURE] business_rules vide — fallback captureDelayMinutes=60');
    }

    // Trouver les campagnes autorisées dont la grace period est écoulée
    const cutoffDate = new Date(Date.now() - captureDelayMinutes * 60 * 1000);

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: { in: [CampaignStatus.PENDING_PAYMENT, CampaignStatus.PENDING_ACTIVATION] },
        paymentAuthorizedAt: {
          not: null,
          lte: cutoffDate,
        },
        paymentCapturedAt: null,
        stripePaymentIntentId: { not: null },
      },
    });

    if (campaigns.length === 0) return;

    this.logger.log(`[AUTO-CAPTURE] Found ${campaigns.length} campaigns to capture (delay: ${captureDelayMinutes}min)`);

    for (const campaign of campaigns) {
      try {
        // Vérifier l'état RÉEL du PaymentIntent AVANT de capturer (robustesse + idempotence) :
        // - requires_capture → on capture
        // - succeeded → déjà capturé (webhook ou pod concurrent) → réconciliation sans recapture
        // - autre (canceled / requires_payment_method / processing…) → non capturable → erreur gérée
        let pi = await this.stripeService.getPaymentIntent(campaign.stripePaymentIntentId!);
        if (pi.status === 'requires_capture') {
          try {
            pi = await this.stripeService.capturePaymentIntent(campaign.stripePaymentIntentId!);
            this.logger.log(`[AUTO-CAPTURE] Captured PI ${pi.id} for campaign ${campaign.id}`);
          } catch (captureErr) {
            // B3 — course multi-pods : un autre replica a pu capturer entre le read et le capture.
            // On re-vérifie l'état réel avant de considérer ça comme un échec.
            pi = await this.stripeService.getPaymentIntent(campaign.stripePaymentIntentId!);
            if (pi.status !== 'succeeded') throw captureErr;
            this.logger.warn(`[AUTO-CAPTURE] PI ${pi.id} déjà capturé par un appel concurrent (campagne ${campaign.id})`);
          }
        } else if (pi.status !== 'succeeded') {
          throw new Error(`PaymentIntent ${pi.id} non capturable (status=${pi.status})`);
        }

        // Activation + crédit escrow via la logique PARTAGÉE et IDEMPOTENTE
        // (flip atomique transaction PENDING→COMPLETED = un seul crédit possible,
        //  même avec webhook / endpoint / autre pod en concurrence).
        const transaction = await this.prisma.transaction.findFirst({
          where: {
            campaignId: campaign.id,
            stripePaymentIntentId: campaign.stripePaymentIntentId,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (transaction?.stripeSessionId) {
          const result = await this.paymentReconciliation.reconcileCheckoutSession(
            transaction.stripeSessionId,
            'scheduler',
          );
          this.logger.log(
            `[AUTO-CAPTURE] Campaign ${campaign.id} reconciled (${result.outcome}) after ${captureDelayMinutes}min grace period`,
          );
        } else {
          // Fallback legacy (transaction sans Checkout Session) : activation directe idempotente
          await this.prisma.$transaction(async (tx) => {
            if (transaction) {
              const flipped = await tx.transaction.updateMany({
                where: { id: transaction.id, status: 'PENDING' as any },
                data: { status: 'COMPLETED' as any },
              });
              if (flipped.count === 1) {
                const platformWallet = await tx.platformWallet.findFirst();
                if (platformWallet) {
                  await tx.platformWallet.update({
                    where: { id: platformWallet.id },
                    data: {
                      escrowBalance: { increment: new Decimal(Number(transaction.amount)) },
                      totalReceived: { increment: new Decimal(Number(transaction.amount)) },
                    },
                  });
                }
              }
            }
            await tx.campaign.update({
              where: { id: campaign.id },
              data: {
                status: CampaignStatus.ACTIVE,
                paymentCapturedAt: new Date(),
              },
            });
          });
        }

        // Audit (hors transaction, non critique)
        await this.auditService.log(
          campaign.sellerId,
          AuditCategory.CAMPAIGN,
          'CAMPAIGN_AUTO_CAPTURED',
          {
            campaignId: campaign.id,
            paymentIntentId: campaign.stripePaymentIntentId,
            captureDelayMinutes,
            amount: transaction ? Number(transaction.amount) : null,
          },
        );

        this.logger.log(`[AUTO-CAPTURE] Campaign ${campaign.id} activated after ${captureDelayMinutes}min grace period`);
      } catch (error) {
        this.logger.error(`[AUTO-CAPTURE] Failed to capture campaign ${campaign.id}: ${error.message}`);

        // Tracker les retries via metadata de la transaction
        const failedTx = await this.prisma.transaction.findFirst({
          where: {
            campaignId: campaign.id,
            stripePaymentIntentId: campaign.stripePaymentIntentId,
            status: 'PENDING' as any,
          },
        });

        const retryCount = ((failedTx?.metadata as any)?.captureRetryCount ?? 0) + 1;
        const MAX_CAPTURE_RETRIES = 3;

        if (failedTx) {
          await this.prisma.transaction.update({
            where: { id: failedTx.id },
            data: {
              metadata: {
                ...(failedTx.metadata as any),
                captureRetryCount: retryCount,
                lastCaptureError: error.message,
                lastCaptureAttempt: new Date().toISOString(),
              },
            },
          });
        }

        // Après MAX_CAPTURE_RETRIES, remettre la campagne en DRAFT pour que le PRO puisse relancer
        if (retryCount >= MAX_CAPTURE_RETRIES) {
          this.logger.error(`[AUTO-CAPTURE] Max retries (${MAX_CAPTURE_RETRIES}) reached for campaign ${campaign.id}, reverting to DRAFT`);

          // SÉCURITÉ : on annule d'abord le PaymentIntent pour LIBÉRER l'autorisation
          // (les fonds bloqués sur la carte du PRO sont relâchés). On ne retire la
          // référence stripePaymentIntentId qu'APRÈS une annulation réussie, pour ne
          // jamais perdre la trace d'un paiement potentiellement encaissé.
          // (Le cas "déjà capturé" est traité plus haut et ne descend pas jusqu'ici.)
          let canceled = false;
          try {
            await this.stripeService.cancelPaymentIntent(campaign.stripePaymentIntentId!, 'abandoned');
            canceled = true;
          } catch (cancelErr) {
            this.logger.error(`[AUTO-CAPTURE] Échec annulation PI ${campaign.stripePaymentIntentId} (campagne ${campaign.id}): ${cancelErr.message}`);
          }

          await this.prisma.campaign.update({
            where: { id: campaign.id },
            data: {
              status: CampaignStatus.DRAFT,
              paymentAuthorizedAt: null,
              ...(canceled ? { stripePaymentIntentId: null } : {}),
            },
          });

          if (failedTx) {
            await this.prisma.transaction.update({
              where: { id: failedTx.id },
              data: { status: 'FAILED' as any },
            });
          }
        }

        await this.auditService.log(
          campaign.sellerId,
          AuditCategory.WALLET,
          'AUTO_CAPTURE_FAILED',
          {
            campaignId: campaign.id,
            paymentIntentId: campaign.stripePaymentIntentId,
            error: error.message,
            retryCount,
            maxRetries: MAX_CAPTURE_RETRIES,
            revertedToDraft: retryCount >= MAX_CAPTURE_RETRIES,
          },
        );
      }
    }
  }

  /**
   * FILET DE SÉCURITÉ (webhook perdu) — toutes les 5 min en prod, 30 s en local.
   * Campagnes restées PENDING_PAYMENT sans autorisation enregistrée alors que leur
   * Checkout Session est payée chez Stripe (webhook jamais reçu / échoué / local sans
   * `stripe listen`). On interroge Stripe (source de vérité) et on réconcilie via la
   * logique partagée idempotente. Fenêtre 10 min → 48 h :
   *  - < 10 min : on laisse le webhook / le retour Checkout faire leur travail
   *  - > 48 h  : la session Checkout est expirée côté Stripe, plus rien à réconcilier
   */
  @Cron(
    process.env.NODE_ENV === 'production' ? '*/5 * * * *' : '*/30 * * * * *',
    {
      name: 'payment-reconciliation-sweep',
      timeZone: 'Europe/Paris',
    },
  )
  async handleReconciliationSweep() {
    const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const windowEnd = new Date(Date.now() - 10 * 60 * 1000);

    const staleCampaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.PENDING_PAYMENT,
        paymentAuthorizedAt: null,
        paymentCapturedAt: null,
      },
      select: { id: true },
    });

    if (staleCampaigns.length === 0) return;

    const transactions = await this.prisma.transaction.findMany({
      where: {
        campaignId: { in: staleCampaigns.map((c) => c.id) },
        type: 'CAMPAIGN_PAYMENT' as any,
        status: 'PENDING' as any,
        stripeSessionId: { not: null },
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (transactions.length === 0) return;

    // Une seule tentative par campagne (la transaction la plus récente)
    const seen = new Set<string>();
    for (const t of transactions) {
      if (!t.campaignId || seen.has(t.campaignId)) continue;
      seen.add(t.campaignId);

      try {
        const result = await this.paymentReconciliation.reconcileCheckoutSession(
          t.stripeSessionId!,
          'scheduler',
        );
        if (result.outcome === 'authorized' || result.outcome === 'activated') {
          this.logger.warn(
            `[RECONCILE-SWEEP] Campaign ${t.campaignId} récupérée sans webhook (outcome=${result.outcome}) — vérifier la config webhook Stripe`,
          );
        }
      } catch (error) {
        this.logger.error(
          `[RECONCILE-SWEEP] Failed to reconcile campaign ${t.campaignId} (session ${t.stripeSessionId}): ${error.message}`,
        );
      }
    }
  }

  /**
   * CRON quotidien à 6h: sécurité pour les PI > 5 jours non capturés
   * Stripe expire les PI non capturés après 7 jours, donc on les annule proprement avant
   */
  @Cron('0 6 * * *', {
    name: 'payment-stale-cleanup',
    timeZone: 'Europe/Paris',
  })
  async handleStalePayments() {
    // PI autorisés depuis > 5 jours et jamais capturés
    const staleCutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    const staleCampaigns = await this.prisma.campaign.findMany({
      where: {
        status: { in: [CampaignStatus.PENDING_PAYMENT, CampaignStatus.PENDING_ACTIVATION] },
        paymentAuthorizedAt: {
          not: null,
          lte: staleCutoff,
        },
        paymentCapturedAt: null,
        stripePaymentIntentId: { not: null },
      },
    });

    if (staleCampaigns.length === 0) return;

    this.logger.warn(`[STALE-CLEANUP] Found ${staleCampaigns.length} stale PI (>5 days)`);

    for (const campaign of staleCampaigns) {
      try {
        // Annuler le PI car il va expirer chez Stripe dans 2 jours
        await this.stripeService.cancelPaymentIntent(
          campaign.stripePaymentIntentId!,
          'abandoned',
        );

        // Mettre à jour campagne + transactions associées atomiquement
        await this.prisma.$transaction([
          this.prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: CampaignStatus.CANCELLED },
          }),
          this.prisma.transaction.updateMany({
            where: {
              campaignId: campaign.id,
              stripePaymentIntentId: campaign.stripePaymentIntentId,
              status: 'PENDING' as any,
            },
            data: { status: 'CANCELLED' as any },
          }),
        ]);

        await this.auditService.log(
          campaign.sellerId,
          AuditCategory.CAMPAIGN,
          'CAMPAIGN_STALE_CANCELLED',
          {
            campaignId: campaign.id,
            paymentIntentId: campaign.stripePaymentIntentId,
            reason: 'PI stale >5 days, cancelled before Stripe 7-day expiry',
          },
        );

        this.logger.warn(`[STALE-CLEANUP] Cancelled stale campaign ${campaign.id}`);
      } catch (error) {
        this.logger.error(`[STALE-CLEANUP] Failed to cancel stale campaign ${campaign.id}: ${error.message}`);
      }
    }
  }
}
