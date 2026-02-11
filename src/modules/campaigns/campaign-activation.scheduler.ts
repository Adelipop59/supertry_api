import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditCategory, CampaignStatus } from '@prisma/client';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';

@Injectable()
export class CampaignActivationScheduler {
  private readonly logger = new Logger(CampaignActivationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * CRON toutes les 2 minutes: active automatiquement les campagnes PENDING_ACTIVATION
   * dont la grace period est terminée (activationGracePeriodEndsAt < maintenant)
   */
  @Cron('*/2 * * * *', {
    name: 'campaign-auto-activation',
    timeZone: 'Europe/Paris',
  })
  async handleAutoActivation() {
    const now = new Date();

    // Trouver les campagnes PENDING_ACTIVATION dont la grace period est terminée
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.PENDING_ACTIVATION,
        activationGracePeriodEndsAt: {
          not: null,
          lte: now,
        },
      },
      include: {
        seller: true,
      },
    });

    if (campaigns.length === 0) return;

    this.logger.log(
      `[AUTO-ACTIVATION] Found ${campaigns.length} campaigns to activate (grace period ended)`,
    );

    for (const campaign of campaigns) {
      try {
        // Activer la campagne
        await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            status: CampaignStatus.ACTIVE,
          },
        });

        this.logger.log(
          `[AUTO-ACTIVATION] Activated campaign ${campaign.id} - ${campaign.title}`,
        );

        // Audit log
        await this.auditService.log(
          campaign.sellerId,
          AuditCategory.CAMPAIGN,
          'CAMPAIGN_AUTO_ACTIVATED',
          {
            campaignId: campaign.id,
            title: campaign.title,
            totalSlots: campaign.totalSlots,
            gracePeriodEnded: true,
          },
        );

        // Notification au PRO
        await this.notificationsService.queueEmail({
          to: campaign.seller.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Votre campagne est maintenant active',
          variables: {
            firstName: campaign.seller.firstName || 'Pro',
            campaignTitle: campaign.title,
            message: `Votre campagne "${campaign.title}" est maintenant visible par les testeurs. La période de grâce d'1 heure est terminée. Vous pouvez suivre les candidatures dans votre tableau de bord.`,
          },
          metadata: {
            campaignId: campaign.id,
            type: 'campaign_activated',
          },
        });
      } catch (error) {
        this.logger.error(
          `[AUTO-ACTIVATION] Failed to activate campaign ${campaign.id}: ${error.message}`,
          error.stack,
        );
      }
    }
  }
}
