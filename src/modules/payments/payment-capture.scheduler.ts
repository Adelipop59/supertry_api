import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { AuditService } from '../audit/audit.service';
import { AuditCategory, CampaignStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class PaymentCaptureScheduler {
  private readonly logger = new Logger(PaymentCaptureScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly auditService: AuditService,
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
    const rules = await this.businessRulesService.findLatest();
    const captureDelayMinutes = rules.captureDelayMinutes;

    // Trouver les campagnes PENDING_PAYMENT avec paymentAuthorizedAt > captureDelayMinutes
    const cutoffDate = new Date(Date.now() - captureDelayMinutes * 60 * 1000);

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.PENDING_PAYMENT,
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
        // Capturer le PaymentIntent
        const pi = await this.stripeService.capturePaymentIntent(campaign.stripePaymentIntentId!);

        this.logger.log(`[AUTO-CAPTURE] Captured PI ${pi.id} for campaign ${campaign.id}`);

        // Mettre à jour la campagne
        await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            status: CampaignStatus.ACTIVE,
            paymentCapturedAt: new Date(),
          },
        });

        // Mettre à jour la transaction
        const transaction = await this.prisma.transaction.findFirst({
          where: {
            campaignId: campaign.id,
            stripePaymentIntentId: campaign.stripePaymentIntentId,
          },
        });

        if (transaction) {
          await this.prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'COMPLETED' as any },
          });
        }

        // Mettre à jour PlatformWallet: ajouter à l'escrow
        const platformWallet = await this.prisma.platformWallet.findFirst();
        if (platformWallet && transaction) {
          await this.prisma.platformWallet.update({
            where: { id: platformWallet.id },
            data: {
              escrowBalance: { increment: new Decimal(Number(transaction.amount)) },
              totalReceived: { increment: new Decimal(Number(transaction.amount)) },
            },
          });
        }

        // Audit
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

        await this.auditService.log(
          campaign.sellerId,
          AuditCategory.WALLET,
          'AUTO_CAPTURE_FAILED',
          {
            campaignId: campaign.id,
            paymentIntentId: campaign.stripePaymentIntentId,
            error: error.message,
          },
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
        status: CampaignStatus.PENDING_PAYMENT,
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

        await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: CampaignStatus.CANCELLED },
        });

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
