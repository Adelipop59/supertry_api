import {
  Injectable,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { AuditService } from '../audit/audit.service';
import {
  CampaignStatus,
  CampaignMarketplaceMode,
  SessionStatus,
  AuditCategory,
  UserRole,
} from '@prisma/client';
import { CancelCampaignDto } from './dto/cancel-campaign.dto';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';

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
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new I18nHttpException('dispute.invalid_status', 'CAMPAIGN_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    if (!campaign.stripePaymentIntentId) {
      throw new I18nHttpException('common.not_found', 'CAMPAIGN_NO_PAYMENT', HttpStatus.BAD_REQUEST);
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
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
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
        offers: true,
        testSessions: {
          where: {
            status: {
              in: [
                SessionStatus.PENDING,
                SessionStatus.ACCEPTED,
                SessionStatus.PRICE_VALIDATED,
                SessionStatus.PURCHASE_SUBMITTED,
                SessionStatus.PURCHASE_VALIDATED,
              ],
            },
          },
          select: {
            id: true,
            testerId: true,
            status: true,
            productPrice: true,
            shippingCost: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new I18nHttpException('common.not_found', 'CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (campaign.status === CampaignStatus.CANCELLED) {
      throw new I18nHttpException('dispute.invalid_status', 'CAMPAIGN_ALREADY_CANCELLED', HttpStatus.BAD_REQUEST);
    }

    return campaign;
  }

  /**
   * Shared: execute cancellation with refund processing
   */
  /**
   * Calcule la compensation individuelle par testeur selon le mode et le statut
   */
  private calculatePerTesterCompensation(
    session: { testerId: string; status: SessionStatus; productPrice: any; shippingCost: any },
    marketplaceMode: CampaignMarketplaceMode,
    flatComp: number,
    maxPrice: number,
    maxShipping: number,
  ): number {
    const isProductLink = marketplaceMode === CampaignMarketplaceMode.PRODUCT_LINK;

    // PURCHASE_VALIDATED → prix réel validé par le PRO
    if (session.status === SessionStatus.PURCHASE_VALIDATED && session.productPrice != null) {
      return flatComp + Number(session.productPrice) + Number(session.shippingCost ?? 0);
    }

    // PRODUCT_LINK : tout testeur ACCEPTED+ est considéré comme ayant potentiellement acheté
    if (isProductLink) {
      return flatComp + maxPrice + maxShipping;
    }

    // PROCEDURES : PRICE_VALIDATED ou PURCHASE_SUBMITTED → a acheté au maxPrice
    if (
      session.status === SessionStatus.PRICE_VALIDATED ||
      session.status === SessionStatus.PURCHASE_SUBMITTED
    ) {
      return flatComp + maxPrice + maxShipping;
    }

    // PROCEDURES : ACCEPTED → n'a pas encore acheté
    return flatComp;
  }

  /**
   * Détermine si un testeur est "bought" (a potentiellement acheté le produit)
   * → éligible à la commission SuperTry
   */
  private isBoughtTester(
    session: { status: SessionStatus },
    marketplaceMode: CampaignMarketplaceMode,
  ): boolean {
    // PRODUCT_LINK : tout testeur ACCEPTED+ est considéré comme bought
    if (marketplaceMode === CampaignMarketplaceMode.PRODUCT_LINK) {
      return true;
    }

    // PROCEDURES : bought si PRICE_VALIDATED, PURCHASE_SUBMITTED ou PURCHASE_VALIDATED
    const boughtStatuses: SessionStatus[] = [
      SessionStatus.PRICE_VALIDATED,
      SessionStatus.PURCHASE_SUBMITTED,
      SessionStatus.PURCHASE_VALIDATED,
    ];
    return boughtStatuses.includes(session.status);
  }

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
    stripeRefundId: string | null;
  }> {
    const activatedAt = campaign.paymentCapturedAt || campaign.paymentAuthorizedAt || campaign.createdAt;
    const hoursElapsed = (Date.now() - activatedAt.getTime()) / (1000 * 60 * 60);

    // Filtrer les testeurs éligibles à compensation (exclure PENDING)
    const eligibleSessions = campaign.testSessions.filter(
      (session: any) =>
        session.status === SessionStatus.ACCEPTED ||
        session.status === SessionStatus.PRICE_VALIDATED ||
        session.status === SessionStatus.PURCHASE_SUBMITTED ||
        session.status === SessionStatus.PURCHASE_VALIDATED,
    );

    // Calculer la compensation individuelle par testeur
    const rules = await this.businessRulesService.findLatest();
    const maxPrice = Number(campaign.offers?.[0]?.maxReimbursedPrice ?? campaign.offers?.[0]?.expectedPrice ?? 0);
    const maxShipping = Number(campaign.offers?.[0]?.maxReimbursedShipping ?? campaign.offers?.[0]?.shippingCost ?? 0);
    const flatComp = Number(rules.testerCompensationOnProCancellation);

    const compensationMap: Record<string, number> = {};
    let totalCompensation = 0;
    let boughtTestersCount = 0;

    for (const session of eligibleSessions) {
      const amount = this.calculatePerTesterCompensation(
        session,
        campaign.marketplaceMode,
        flatComp,
        maxPrice,
        maxShipping,
      );
      compensationMap[session.testerId] = amount;
      totalCompensation += amount;

      if (this.isBoughtTester(session, campaign.marketplaceMode)) {
        boughtTestersCount++;
      }
    }

    // Commission SuperTry : 1 commission par testeur "bought"
    const commissionPerTester = Number(rules.commissionFixedFee);
    const totalCommission = boughtTestersCount * commissionPerTester;

    this.logger.log(
      `${auditAction}: ${userId} cancelling campaign ${campaign.id}. Hours elapsed: ${hoursElapsed.toFixed(2)}, Eligible testers: ${eligibleSessions.length}, Bought: ${boughtTestersCount}, Total compensation: ${totalCompensation}€, Commission: ${totalCommission}€`,
    );

    // Marquer la campagne CANCELLED en DB AVANT d'appeler Stripe
    // → protège contre double remboursement si Stripe réussit mais DB échoue ensuite
    const updatedCampaign = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: CampaignStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: dto.cancellationReason,
      },
    });

    const {
      refundToPro,
      cancellationFee,
      refund,
    } = await this.paymentsService.processCampaignCancellationRefund(campaign.id, {
      hoursElapsed,
      totalCompensation,
      totalCommission,
      compensationMap,
    });

    await this.prisma.testSession.updateMany({
      where: {
        campaignId: campaign.id,
        status: {
          in: [
            SessionStatus.PENDING,
            SessionStatus.ACCEPTED,
            SessionStatus.PRICE_VALIDATED,
            SessionStatus.PURCHASE_SUBMITTED,
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
        totalCompensation,
        totalCommission,
        boughtTestersCount,
        compensationMap,
        acceptedTestersCount: eligibleSessions.length,
      },
    );

    this.logger.log(`Campaign ${campaign.id} cancelled by ${userId}`);

    return {
      campaign: updatedCampaign,
      refundToPro,
      cancellationFee,
      compensationPerTester: flatComp,
      acceptedTestersCount: eligibleSessions.length,
      stripeRefundId: refund?.id ?? null,
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
    stripeFee: number;
    supertryCommission: number;
    totalPaid: number;
    gracePeriodEndsAt: string | null;
  }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        offers: true,
        testSessions: {
          where: {
            status: {
              in: [
                SessionStatus.ACCEPTED,
                SessionStatus.PRICE_VALIDATED,
                SessionStatus.PURCHASE_SUBMITTED,
                SessionStatus.PURCHASE_VALIDATED,
              ],
            },
          },
          select: {
            id: true,
            testerId: true,
            status: true,
            productPrice: true,
            shippingCost: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new I18nHttpException('common.not_found', 'CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const user = await this.prisma.profile.findUnique({
      where: { id: userId },
    });

    // Vérifier les permissions
    if (user!.role !== UserRole.ADMIN && campaign.sellerId !== userId) {
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
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
        stripeFee: 0,
        supertryCommission: 0,
        totalPaid: 0,
        gracePeriodEndsAt: campaign.activationGracePeriodEndsAt?.toISOString() ?? null,
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
        stripeFee: 0,
        supertryCommission: 0,
        totalPaid: 0,
        gracePeriodEndsAt: campaign.activationGracePeriodEndsAt?.toISOString() ?? null,
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
        stripeFee: 0,
        supertryCommission: 0,
        totalPaid: 0,
        gracePeriodEndsAt: campaign.activationGracePeriodEndsAt?.toISOString() ?? null,
      };
    }

    const activatedAt = campaign.paymentCapturedAt || campaign.paymentAuthorizedAt || campaign.createdAt;
    const hoursElapsed = (Date.now() - activatedAt.getTime()) / (1000 * 60 * 60);

    const acceptedTestersCount = campaign.testSessions.length;
    const totalEscrowAmount = Number(campaign.escrowAmount || 0);

    // Calcul compensation individuelle par testeur
    const rules = await this.businessRulesService.findLatest();
    const maxPrice = Number(campaign.offers?.[0]?.maxReimbursedPrice ?? campaign.offers?.[0]?.expectedPrice ?? 0);
    const maxShipping = Number(campaign.offers?.[0]?.maxReimbursedShipping ?? campaign.offers?.[0]?.shippingCost ?? 0);
    const flatComp = Number(rules.testerCompensationOnProCancellation);

    let totalCompensation = 0;
    let boughtTestersCount = 0;
    for (const session of campaign.testSessions) {
      totalCompensation += this.calculatePerTesterCompensation(
        session,
        campaign.marketplaceMode,
        flatComp,
        maxPrice,
        maxShipping,
      );
      if (this.isBoughtTester(session, campaign.marketplaceMode)) {
        boughtTestersCount++;
      }
    }

    // Commission SuperTry retenue par bought tester
    const commissionPerTester = Number(rules.commissionFixedFee);
    const totalCommission = boughtTestersCount * commissionPerTester;

    const { refundToPro, cancellationFee, supertryCommission } =
      await this.businessRulesService.calculateProCancellationImpact(
        totalEscrowAmount,
        hoursElapsed,
        totalCompensation,
        totalCommission,
      );
    const compensationPerTester = flatComp;

    const gracePeriodMinutes =
      await this.businessRulesService.getCampaignActivationGracePeriodMinutes();
    const inGracePeriod = hoursElapsed < gracePeriodMinutes / 60;

    // Enrichissement : frais Stripe, total payé
    const { stripeCoverage } =
      await this.businessRulesService.calculateCommission(
        totalEscrowAmount - Number(rules.commissionFixedFee),
      );
    const stripeFee = Math.round(stripeCoverage * 100) / 100;
    const totalPaid = Math.round((totalEscrowAmount + stripeFee) * 100) / 100;

    // Pour PENDING_ACTIVATION (non capturé), Stripe annule le PI sans frais
    const paymentCaptured = !!campaign.paymentCapturedAt;
    const effectiveRefundToPro = paymentCaptured ? refundToPro : Math.min(refundToPro + stripeFee, totalPaid);
    const effectiveStripeFee = paymentCaptured ? stripeFee : 0;

    return {
      canCancel: true,
      refundToPro: Math.round(effectiveRefundToPro * 100) / 100,
      cancellationFee,
      compensationPerTester,
      acceptedTestersCount,
      totalCompensation: Math.round(totalCompensation * 100) / 100,
      hoursElapsed: Math.round(hoursElapsed * 100) / 100,
      inGracePeriod,
      stripeFee: effectiveStripeFee,
      supertryCommission,
      totalPaid,
      gracePeriodEndsAt: campaign.activationGracePeriodEndsAt?.toISOString() ?? null,
    };
  }
}
