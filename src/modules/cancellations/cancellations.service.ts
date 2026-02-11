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
  ): Promise<{
    campaign: any;
    refundToPro: number;
    cancellationFee: number;
    compensationPerTester: number;
    acceptedTestersCount: number;
  }> {
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
          include: {
            tester: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.sellerId !== sellerId) {
      throw new ForbiddenException('You can only cancel your own campaigns');
    }

    if (campaign.status === CampaignStatus.CANCELLED) {
      throw new BadRequestException('Campaign is already cancelled');
    }

    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed campaign');
    }

    if (!campaign.stripePaymentIntentId) {
      throw new BadRequestException('Campaign has no payment to refund');
    }

    // Calculer le temps écoulé depuis le paiement (activation)
    const activatedAt = campaign.paymentCapturedAt || campaign.paymentAuthorizedAt || campaign.createdAt;
    const hoursElapsed = (Date.now() - activatedAt.getTime()) / (1000 * 60 * 60);

    // Récupérer les testeurs acceptés
    const acceptedTesters = campaign.testSessions.filter(
      (session) =>
        session.status === SessionStatus.ACCEPTED ||
        session.status === SessionStatus.PRICE_VALIDATED ||
        session.status === SessionStatus.PURCHASE_VALIDATED,
    );

    const acceptedTesterIds = acceptedTesters.map((s) => s.testerId);

    this.logger.log(
      `PRO ${sellerId} cancelling campaign ${campaignId}. Hours elapsed: ${hoursElapsed.toFixed(2)}, Accepted testers: ${acceptedTesters.length}`,
    );

    // Traiter le remboursement
    const {
      refundToPro,
      cancellationFee,
      compensationPerTester,
    } = await this.paymentsService.processCampaignCancellationRefund(campaignId, {
      hoursElapsed,
      acceptedTestersCount: acceptedTesters.length,
      acceptedTesterIds,
    });

    // Mettre à jour la campagne
    const updatedCampaign = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: CampaignStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: sellerId,
        cancellationReason: dto.cancellationReason,
      },
    });

    // Annuler toutes les sessions actives
    await this.prisma.testSession.updateMany({
      where: {
        campaignId,
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

    // Audit
    await this.auditService.log(
      sellerId,
      AuditCategory.CAMPAIGN,
      'CAMPAIGN_CANCELLED_BY_PRO',
      {
        campaignId,
        reason: dto.cancellationReason,
        hoursElapsed,
        refundToPro,
        cancellationFee,
        compensationPerTester,
        acceptedTestersCount: acceptedTesters.length,
      },
    );

    this.logger.log(`Campaign ${campaignId} cancelled by PRO ${sellerId}`);

    return {
      campaign: updatedCampaign,
      refundToPro,
      cancellationFee,
      compensationPerTester,
      acceptedTestersCount: acceptedTesters.length,
    };
  }

  /**
   * Annule une campagne par un ADMIN
   */
  async cancelCampaignByAdmin(
    campaignId: string,
    adminId: string,
    dto: CancelCampaignDto,
  ): Promise<{
    campaign: any;
    refundToPro: number;
    cancellationFee: number;
    compensationPerTester: number;
    acceptedTestersCount: number;
  }> {
    const admin = await this.prisma.profile.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can force cancel campaigns');
    }

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

    // Si paiement existe, appliquer les mêmes règles que PRO
    const activatedAt = campaign.paymentCapturedAt || campaign.paymentAuthorizedAt || campaign.createdAt;
    const hoursElapsed = (Date.now() - activatedAt.getTime()) / (1000 * 60 * 60);

    const acceptedTesters = campaign.testSessions.filter(
      (session) =>
        session.status === SessionStatus.ACCEPTED ||
        session.status === SessionStatus.PRICE_VALIDATED ||
        session.status === SessionStatus.PURCHASE_VALIDATED,
    );

    const acceptedTesterIds = acceptedTesters.map((s) => s.testerId);

    this.logger.log(
      `ADMIN ${adminId} cancelling campaign ${campaignId}. Hours elapsed: ${hoursElapsed.toFixed(2)}, Accepted testers: ${acceptedTesters.length}`,
    );

    const {
      refundToPro,
      cancellationFee,
      compensationPerTester,
    } = await this.paymentsService.processCampaignCancellationRefund(campaignId, {
      hoursElapsed,
      acceptedTestersCount: acceptedTesters.length,
      acceptedTesterIds,
    });

    const updatedCampaign = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: CampaignStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: adminId,
        cancellationReason: dto.cancellationReason,
      },
    });

    await this.prisma.testSession.updateMany({
      where: {
        campaignId,
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
      adminId,
      AuditCategory.CAMPAIGN,
      'CAMPAIGN_CANCELLED_BY_ADMIN',
      {
        campaignId,
        reason: dto.cancellationReason,
        hoursElapsed,
        refundToPro,
        cancellationFee,
        compensationPerTester,
        acceptedTestersCount: acceptedTesters.length,
      },
    );

    this.logger.log(`Campaign ${campaignId} cancelled by ADMIN ${adminId}`);

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
