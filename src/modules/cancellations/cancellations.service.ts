import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { AuditService } from '../audit/audit.service';
import {
  CampaignStatus,
  SessionStatus,
  AuditCategory,
  UserRole,
} from '@prisma/client';
import { CancelCampaignDto } from './dto/cancel-campaign.dto';

@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Annule une campagne par un PRO
   */
  async cancelCampaignByPro(
    campaignId: string,
    sellerId: string,
    dto: CancelCampaignDto,
  ) {
    const campaign = await this.findCampaignForCancellation(campaignId);

    if (campaign.sellerId !== sellerId) {
      throw new ForbiddenException('You can only cancel your own campaigns');
    }

    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed campaign');
    }

    if (!campaign.stripePaymentIntentId) {
      throw new BadRequestException('Campaign has no payment to refund');
    }

    return this.executeCancellation(campaign, sellerId, dto, 'CAMPAIGN_CANCELLED_BY_PRO');
  }

  /**
   * Annule une campagne par un ADMIN
   */
  async cancelCampaignByAdmin(
    campaignId: string,
    adminId: string,
    dto: CancelCampaignDto,
  ) {
    const admin = await this.prisma.profile.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can force cancel campaigns');
    }

    const campaign = await this.findCampaignForCancellation(campaignId);

    // Les ADMIN peuvent forcer l'annulation même sans paiement
    if (!campaign.stripePaymentIntentId) {
      const updatedCampaign = await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: CampaignStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: adminId,
          cancellationReason: dto.cancellationReason,
        },
      });

      await this.auditService.log(
        adminId,
        AuditCategory.CAMPAIGN,
        'CAMPAIGN_CANCELLED_BY_ADMIN',
        {
          campaignId,
          reason: dto.cancellationReason,
          forceCancel: true,
        },
      );

      return {
        campaign: updatedCampaign,
        refundToPro: 0,
        cancellationFee: 0,
        compensationPerTester: 0,
        acceptedTestersCount: 0,
      };
    }

    return this.executeCancellation(campaign, adminId, dto, 'CAMPAIGN_CANCELLED_BY_ADMIN');
  }

  /**
   * Shared: find campaign with active sessions for cancellation
   */
  private async findCampaignForCancellation(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        testSessions: {
          where: {
            status: {
              in: [
                SessionStatus.PENDING,
                SessionStatus.ACCEPTED,
                SessionStatus.PRICE_VALIDATED,
                SessionStatus.PURCHASE_VALIDATED,
              ],
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status === CampaignStatus.CANCELLED) {
      throw new BadRequestException('Campaign is already cancelled');
    }

    return campaign;
  }

  /**
   * Shared: execute cancellation with refund processing
   */
  private async executeCancellation(
    campaign: any,
    userId: string,
    dto: CancelCampaignDto,
    auditAction: string,
  ): Promise<{
    campaign: any;
    refundToPro: number;
    cancellationFee: number;
    compensationPerTester: number;
    acceptedTestersCount: number;
  }> {
    const activatedAt = campaign.paymentCapturedAt || campaign.paymentAuthorizedAt || campaign.createdAt;
    const hoursElapsed = (Date.now() - activatedAt.getTime()) / (1000 * 60 * 60);

    const acceptedTesters = campaign.testSessions.filter(
      (session: any) =>
        session.status === SessionStatus.ACCEPTED ||
        session.status === SessionStatus.PRICE_VALIDATED ||
        session.status === SessionStatus.PURCHASE_VALIDATED,
    );

    const acceptedTesterIds = acceptedTesters.map((s: any) => s.testerId);

    this.logger.log(
      `${auditAction}: ${userId} cancelling campaign ${campaign.id}. Hours elapsed: ${hoursElapsed.toFixed(2)}, Accepted testers: ${acceptedTesters.length}`,
    );

    const {
      refundToPro,
      cancellationFee,
      compensationPerTester,
    } = await this.paymentsService.processCampaignCancellationRefund(campaign.id, {
      hoursElapsed,
      acceptedTestersCount: acceptedTesters.length,
      acceptedTesterIds,
    });

    const updatedCampaign = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: CampaignStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: dto.cancellationReason,
      },
    });

    await this.prisma.testSession.updateMany({
      where: {
        campaignId: campaign.id,
        status: {
          in: [
            SessionStatus.PENDING,
            SessionStatus.ACCEPTED,
            SessionStatus.PRICE_VALIDATED,
            SessionStatus.PURCHASE_VALIDATED,
          ],
        },
      },
      data: {
        status: SessionStatus.CANCELLED,
      },
    });

    await this.auditService.log(
      userId,
      AuditCategory.CAMPAIGN,
      auditAction,
      {
        campaignId: campaign.id,
        reason: dto.cancellationReason,
        hoursElapsed,
        refundToPro,
        cancellationFee,
        compensationPerTester,
        acceptedTestersCount: acceptedTesters.length,
      },
    );

    this.logger.log(`Campaign ${campaign.id} cancelled by ${userId}`);

    return {
      campaign: updatedCampaign,
      refundToPro,
      cancellationFee,
      compensationPerTester,
      acceptedTestersCount: acceptedTesters.length,
    };
  }

  /**
   * Calcule l'impact d'une annulation de campagne sans l'exécuter
   * Permet au PRO de voir les frais avant de confirmer
   */
  async calculateCancellationImpact(
    campaignId: string,
    userId: string,
  ): Promise<{
    canCancel: boolean;
    reason?: string;
    refundToPro: number;
    cancellationFee: number;
    compensationPerTester: number;
    acceptedTestersCount: number;
    totalCompensation: number;
    hoursElapsed: number;
    inGracePeriod: boolean;
  }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        testSessions: {
          where: {
            status: {
              in: [
                SessionStatus.ACCEPTED,
                SessionStatus.PRICE_VALIDATED,
                SessionStatus.PURCHASE_VALIDATED,
              ],
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const user = await this.prisma.profile.findUnique({
      where: { id: userId },
    });

    // Vérifier les permissions
    if (user!.role !== UserRole.ADMIN && campaign.sellerId !== userId) {
      throw new ForbiddenException('You can only view your own campaign cancellation impact');
    }

    if (campaign.status === CampaignStatus.CANCELLED) {
      return {
        canCancel: false,
        reason: 'Campaign is already cancelled',
        refundToPro: 0,
        cancellationFee: 0,
        compensationPerTester: 0,
        acceptedTestersCount: 0,
        totalCompensation: 0,
        hoursElapsed: 0,
        inGracePeriod: false,
      };
    }

    if (campaign.status === CampaignStatus.COMPLETED) {
      return {
        canCancel: false,
        reason: 'Cannot cancel a completed campaign',
        refundToPro: 0,
        cancellationFee: 0,
        compensationPerTester: 0,
        acceptedTestersCount: 0,
        totalCompensation: 0,
        hoursElapsed: 0,
        inGracePeriod: false,
      };
    }

    if (!campaign.stripePaymentIntentId) {
      return {
        canCancel: true,
        refundToPro: 0,
        cancellationFee: 0,
        compensationPerTester: 0,
        acceptedTestersCount: 0,
        totalCompensation: 0,
        hoursElapsed: 0,
        inGracePeriod: true,
      };
    }

    const activatedAt = campaign.paymentCapturedAt || campaign.paymentAuthorizedAt || campaign.createdAt;
    const hoursElapsed = (Date.now() - activatedAt.getTime()) / (1000 * 60 * 60);

    const acceptedTestersCount = campaign.testSessions.length;

    // Récupérer le montant total escrow depuis le platformWallet
    const platformWallet = await this.prisma.platformWallet.findFirst();
    const totalEscrowAmount = Number(platformWallet?.escrowBalance || 0);

    const { refundToPro, cancellationFee, compensationPerTester } =
      await this.businessRulesService.calculateProCancellationImpact(
        totalEscrowAmount,
        hoursElapsed,
        acceptedTestersCount > 0,
      );

    const totalCompensation = compensationPerTester * acceptedTestersCount;
    const gracePeriodMinutes =
      await this.businessRulesService.getCampaignActivationGracePeriodMinutes();
    const inGracePeriod = hoursElapsed < gracePeriodMinutes / 60;

    return {
      canCancel: true,
      refundToPro,
      cancellationFee,
      compensationPerTester,
      acceptedTestersCount,
      totalCompensation,
      hoursElapsed: Math.round(hoursElapsed * 100) / 100,
      inGracePeriod,
    };
  }
}
