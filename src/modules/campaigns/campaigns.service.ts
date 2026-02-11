import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../stripe/stripe.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { CampaignResponseDto } from './dto/campaign-response.dto';
import { CampaignFilterDto } from './dto/campaign-filter.dto';
import { CheckEligibilityResponseDto } from './dto/check-eligibility-response.dto';
import {
  PaginatedResponse,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { CampaignMarketplaceMode, CampaignStatus, AuditCategory, NotificationType } from '@prisma/client';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private readonly SUPERTRY_COMMISSION = 5.0;
  private readonly MIN_TESTER_BONUS = 5.0;

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private stripeService: StripeService,
    private businessRulesService: BusinessRulesService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  async create(
    sellerId: string,
    createDto: CreateCampaignDto,
  ): Promise<CampaignResponseDto> {
    // Validation 1: MarketplaceMode validation
    if (
      createDto.marketplaceMode === CampaignMarketplaceMode.PROCEDURES &&
      (!createDto.procedures || createDto.procedures.length === 0)
    ) {
      throw new BadRequestException(
        'Procedures are required when marketplaceMode is PROCEDURES',
      );
    }

    if (
      createDto.marketplaceMode === CampaignMarketplaceMode.PRODUCT_LINK &&
      !createDto.amazonLink
    ) {
      throw new BadRequestException(
        'amazonLink is required when marketplaceMode is PRODUCT_LINK',
      );
    }

    // Validation 2: Distributions validation
    if (!createDto.distributions || createDto.distributions.length === 0) {
      throw new BadRequestException(
        'At least one distribution date is required',
      );
    }

    for (const dist of createDto.distributions) {
      if (dist.type === 'RECURRING' && dist.dayOfWeek === undefined) {
        throw new BadRequestException(
          'dayOfWeek is required for RECURRING distribution',
        );
      }
      if (dist.type === 'SPECIFIC_DATE' && !dist.specificDate) {
        throw new BadRequestException(
          'specificDate is required for SPECIFIC_DATE distribution',
        );
      }
    }

    // Validation 3: Bonus minimum
    if (createDto.offer.bonus < this.MIN_TESTER_BONUS) {
      throw new BadRequestException(
        `Tester bonus must be at least ${this.MIN_TESTER_BONUS}€`,
      );
    }

    // Validation 4: Calculate escrow amount
    const costPerTester =
      (createDto.offer.expectedPrice +
        createDto.offer.shippingCost +
        createDto.offer.bonus +
        this.SUPERTRY_COMMISSION) *
      createDto.offer.quantity;

    const totalEscrow = costPerTester * createDto.totalSlots;

    // Create campaign with all nested relations in transaction
    const {
      offer,
      procedures = [],
      criteria,
      distributions,
      ...campaignData
    } = createDto;

    const campaign = await this.prisma.$transaction(async (tx) => {
      const createdCampaign = await tx.campaign.create({
        data: {
          ...campaignData,
          sellerId,
          availableSlots: createDto.totalSlots,
          escrowAmount: totalEscrow,
          startDate: new Date(createDto.startDate),
          endDate: createDto.endDate ? new Date(createDto.endDate) : null,
          offers: {
            create: {
              ...offer,
              productId: offer.productId,
            },
          },
          procedures:
            procedures.length > 0
              ? {
                  create: procedures.map((proc) => ({
                    title: proc.title,
                    description: proc.description,
                    order: proc.order,
                    isRequired: proc.isRequired,
                    steps: {
                      create: proc.steps,
                    },
                  })),
                }
              : undefined,
          criteria: criteria
            ? {
                create: criteria,
              }
            : undefined,
          distributions: {
            create: distributions.map((dist) => ({
              ...dist,
              specificDate: dist.specificDate
                ? new Date(dist.specificDate)
                : null,
            })),
          },
        },
        include: {
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              avatar: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              icon: true,
            },
          },
          offers: true,
          procedures: {
            include: {
              steps: {
                orderBy: { order: 'asc' },
              },
            },
            orderBy: { order: 'asc' },
          },
          distributions: true,
          criteria: true,
        },
      });

      return createdCampaign;
    });

    return campaign as any;
  }

  async findAll(
    filterDto: CampaignFilterDto,
  ): Promise<PaginatedResponse<CampaignResponseDto>> {
    const {
      page = 1,
      limit = 10,
      categoryId,
      search,
      status,
      minBonus,
      maxBonus,
    } = filterDto;
    const skip = (page - 1) * limit;

    // Toujours exclure PENDING_ACTIVATION (invisible aux testeurs)
    const where: any = {
      status: status || CampaignStatus.ACTIVE,
      NOT: {
        status: CampaignStatus.PENDING_ACTIVATION,
      },
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (minBonus !== undefined || maxBonus !== undefined) {
      where.offers = {
        some: {
          bonus: {},
        },
      };
      if (minBonus !== undefined) {
        where.offers.some.bonus.gte = minBonus;
      }
      if (maxBonus !== undefined) {
        where.offers.some.bonus.lte = maxBonus;
      }
    }

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        skip,
        take: limit,
        include: {
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              avatar: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              icon: true,
            },
          },
          offers: true,
          procedures: {
            include: {
              steps: {
                orderBy: { order: 'asc' },
              },
            },
            orderBy: { order: 'asc' },
          },
          distributions: true,
          criteria: true,
          _count: {
            select: {
              testSessions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    const campaignsWithStats = campaigns.map((c: any) => ({
      ...c,
      sessionsCount: c._count.testSessions,
    }));

    return createPaginatedResponse(campaignsWithStats, total, page, limit);
  }

  async findMyCampaigns(
    sellerId: string,
    filterDto: CampaignFilterDto,
  ): Promise<PaginatedResponse<CampaignResponseDto>> {
    const { page = 1, limit = 10, status, search } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = {
      sellerId,
    };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        skip,
        take: limit,
        include: {
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              avatar: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              icon: true,
            },
          },
          offers: true,
          procedures: {
            include: {
              steps: {
                orderBy: { order: 'asc' },
              },
            },
            orderBy: { order: 'asc' },
          },
          distributions: true,
          criteria: true,
          _count: {
            select: {
              testSessions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    const campaignsWithStats = campaigns.map((c: any) => ({
      ...c,
      sessionsCount: c._count.testSessions,
    }));

    return createPaginatedResponse(campaignsWithStats, total, page, limit);
  }

  async findOne(id: string): Promise<CampaignResponseDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            avatar: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
          },
        },
        offers: true,
        procedures: {
          include: {
            steps: {
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
        distributions: true,
        criteria: true,
        _count: {
          select: {
            testSessions: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign with ID '${id}' not found`);
    }

    return {
      ...campaign,
      sessionsCount: (campaign as any)._count.testSessions,
    } as any;
  }

  async checkEligibility(
    campaignId: string,
    testerId: string,
  ): Promise<CheckEligibilityResponseDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        criteria: true,
        testSessions: {
          where: { testerId },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign with ID '${campaignId}' not found`);
    }

    const tester = await this.prisma.profile.findUnique({
      where: { id: testerId },
      include: {
        _count: {
          select: {
            testSessions: {
              where: { status: 'COMPLETED' },
            },
          },
        },
      },
    });

    if (!tester) {
      throw new NotFoundException(`Tester with ID '${testerId}' not found`);
    }

    const reasons: string[] = [];
    const criteria = campaign.criteria;

    if (!criteria) {
      return { eligible: true };
    }

    // Check age
    if (criteria.minAge && tester.birthDate) {
      const age = this.calculateAge(tester.birthDate);
      if (age < criteria.minAge) {
        reasons.push(`Minimum age required: ${criteria.minAge}`);
      }
    }

    if (criteria.maxAge && tester.birthDate) {
      const age = this.calculateAge(tester.birthDate);
      if (age > criteria.maxAge) {
        reasons.push(`Maximum age allowed: ${criteria.maxAge}`);
      }
    }

    // Check rating
    if (
      criteria.minRating &&
      tester.averageRating &&
      Number(tester.averageRating) < Number(criteria.minRating)
    ) {
      reasons.push(`Minimum rating required: ${criteria.minRating}`);
    }

    // Check completed sessions
    const completedSessions = (tester as any)._count.testSessions;
    if (
      criteria.minCompletedSessions &&
      completedSessions < criteria.minCompletedSessions
    ) {
      reasons.push(
        `Minimum completed sessions required: ${criteria.minCompletedSessions}`,
      );
    }

    // Check gender
    if (criteria.requiredGender && tester.gender !== criteria.requiredGender) {
      reasons.push(`Required gender: ${criteria.requiredGender}`);
    }

    // Check if already has active session with seller
    if (criteria.noActiveSessionWithSeller) {
      const activeSessionWithSeller = await this.prisma.testSession.findFirst({
        where: {
          testerId,
          campaign: {
            sellerId: campaign.sellerId,
          },
          status: {
            in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'],
          },
        },
      });

      if (activeSessionWithSeller) {
        reasons.push('You already have an active session with this seller');
      }
    }

    // Check verified requirement
    if (criteria.requireVerified && !tester.isVerified) {
      reasons.push('Email verification required');
    }

    // Check banned status
    if (tester.bannedUntil && tester.bannedUntil > new Date()) {
      reasons.push(`You are temporarily banned until ${tester.bannedUntil}`);
    }

    return {
      eligible: reasons.length === 0,
      reasons: reasons.length > 0 ? reasons : undefined,
    };
  }

  private calculateAge(birthDate: Date): number {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }
    return age;
  }

  async update(
    id: string,
    sellerId: string,
    updateDto: UpdateCampaignDto,
  ): Promise<CampaignResponseDto> {
    const campaign = await this.findOne(id);

    // Check ownership
    if (campaign.sellerId !== sellerId) {
      throw new ForbiddenException('You can only update your own campaigns');
    }

    // Check if campaign can be updated (not ACTIVE with sessions)
    if (
      campaign.status === CampaignStatus.ACTIVE &&
      campaign.sessionsCount &&
      campaign.sessionsCount > 0
    ) {
      throw new BadRequestException(
        'Cannot update an active campaign with ongoing sessions',
      );
    }

    // Recalculate escrow if offer changes
    let escrowAmount = campaign.escrowAmount;
    if (updateDto.offer || updateDto.totalSlots) {
      const offer = updateDto.offer || campaign.offers[0];
      const totalSlots = updateDto.totalSlots || campaign.totalSlots;

      const costPerTester =
        (Number(offer.expectedPrice) +
          Number(offer.shippingCost) +
          Number(offer.bonus) +
          this.SUPERTRY_COMMISSION) *
        offer.quantity;

      escrowAmount = costPerTester * totalSlots;
    }

    const updateData: any = { ...updateDto };
    if (updateDto.startDate) {
      updateData.startDate = new Date(updateDto.startDate);
    }
    if (updateDto.endDate) {
      updateData.endDate = new Date(updateDto.endDate);
    }
    updateData.escrowAmount = escrowAmount;

    const updatedCampaign = await this.prisma.campaign.update({
      where: { id },
      data: updateData,
      include: {
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            avatar: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
          },
        },
        offers: true,
        procedures: {
          include: {
            steps: {
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
        distributions: true,
        criteria: true,
      },
    });

    return updatedCampaign as any;
  }

  async remove(id: string, sellerId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        sellerId: true,
        status: true,
        stripePaymentIntentId: true,
        paymentAuthorizedAt: true,
        paymentCapturedAt: true,
        totalSlots: true,
        escrowAmount: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign with ID '${id}' not found`);
    }

    if (campaign.sellerId !== sellerId) {
      throw new ForbiddenException('You can only delete your own campaigns');
    }

    const sellerProfile = await this.prisma.profile.findUnique({
      where: { id: sellerId },
      select: { email: true, firstName: true },
    });

    // ===== CAS 1: DRAFT → simple soft delete =====
    if (campaign.status === CampaignStatus.DRAFT) {
      await this.prisma.campaign.update({
        where: { id },
        data: { status: CampaignStatus.CANCELLED },
      });

      await this.auditService.log(sellerId, AuditCategory.CAMPAIGN, 'CAMPAIGN_CANCELLED_DRAFT', {
        campaignId: id,
      });
      return;
    }

    // ===== CAS 2: PENDING_PAYMENT + non capturé → cancel PI (0 frais) =====
    if (
      campaign.status === CampaignStatus.PENDING_PAYMENT &&
      campaign.stripePaymentIntentId &&
      !campaign.paymentCapturedAt
    ) {
      this.logger.log(`[CANCEL] Campaign ${id}: cancelling PI ${campaign.stripePaymentIntentId} (0 fees)`);

      await this.stripeService.cancelPaymentIntent(
        campaign.stripePaymentIntentId,
        'requested_by_customer',
      );

      await this.prisma.campaign.update({
        where: { id },
        data: { status: CampaignStatus.CANCELLED },
      });

      // Mettre à jour la transaction associée
      const transaction = await this.prisma.transaction.findFirst({
        where: { campaignId: id, stripePaymentIntentId: campaign.stripePaymentIntentId },
      });
      if (transaction) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'CANCELLED' as any },
        });
      }

      await this.auditService.log(sellerId, AuditCategory.CAMPAIGN, 'CAMPAIGN_CANCELLED_FREE', {
        campaignId: id,
        paymentIntentId: campaign.stripePaymentIntentId,
        reason: 'PI cancelled before capture (0 fees)',
      });

      if (sellerProfile) {
        await this.notificationsService.queueEmail({
          to: sellerProfile.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Campaign Cancelled - No Charges',
          variables: {
            firstName: sellerProfile.firstName,
            campaignTitle: campaign.title,
            message: `Your campaign "${campaign.title}" has been cancelled. No charges were applied.`,
          },
          metadata: { campaignId: id, type: NotificationType.SYSTEM_ALERT },
        });
      }
      return;
    }

    // ===== CAS 3 & 4: ACTIVE (capturé) → refund partiel ou full =====
    if (campaign.status === CampaignStatus.ACTIVE && campaign.stripePaymentIntentId) {
      const rules = await this.businessRulesService.findLatest();
      const gracePeriodMs = rules.campaignActivationGracePeriodMinutes * 60 * 1000;
      const capturedAt = campaign.paymentCapturedAt || campaign.paymentAuthorizedAt;
      const withinGracePeriod = capturedAt && (Date.now() - capturedAt.getTime()) < gracePeriodMs;

      // Vérifier s'il y a des sessions en cours
      const activeSessions = await this.prisma.testSession.count({
        where: {
          campaignId: id,
          status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
        },
      });

      if (activeSessions > 0) {
        throw new BadRequestException(
          `Cannot cancel campaign with ${activeSessions} active test session(s). Wait for sessions to complete or be cancelled.`,
        );
      }

      const completedSessions = await this.prisma.testSession.count({
        where: { campaignId: id, status: 'COMPLETED' },
      });

      // Calculer le montant déjà utilisé (sessions complétées)
      const escrow = await this.paymentsService.calculateCampaignEscrow(id);
      const usedAmount = escrow.perTester * completedSessions;
      const remainingAmount = Number(campaign.escrowAmount) - usedAmount;

      let refundAmount: number;
      let cancellationFee = 0;

      if (withinGracePeriod) {
        // CAS 3: Dans la période de grâce → refund full du restant
        refundAmount = remainingAmount;
        this.logger.log(`[CANCEL] Campaign ${id}: within grace period, full refund ${refundAmount}€`);
      } else {
        // CAS 4: Hors période de grâce → frais d'annulation
        const feePercent = rules.campaignCancellationFeePercent / 100;
        cancellationFee = Math.round(remainingAmount * feePercent * 100) / 100;
        refundAmount = Math.round((remainingAmount - cancellationFee) * 100) / 100;
        this.logger.log(`[CANCEL] Campaign ${id}: outside grace period, refund ${refundAmount}€ (fee: ${cancellationFee}€)`);
      }

      if (refundAmount > 0) {
        // Metadata riches pour le refund
        const refundMetadata: Record<string, string> = {
          transactionType: withinGracePeriod ? 'PRO_CANCELLATION_REFUND_FREE' : 'PRO_CANCELLATION_REFUND_FEE',
          campaignId: id,
          campaignTitle: campaign.title,
          sellerId,
          sellerEmail: sellerProfile?.email || 'N/A',
          cancellationReason: 'pro_requested',
          withinGracePeriod: String(!!withinGracePeriod),
          cancellationFeePercent: String(rules.campaignCancellationFeePercent),
          cancellationFeeAmount: cancellationFee.toFixed(2),
          refundAmount: refundAmount.toFixed(2),
          originalAmount: String(campaign.escrowAmount),
          completedSlots: String(completedSessions),
          totalSlots: String(campaign.totalSlots),
          originalPaymentIntentId: campaign.stripePaymentIntentId,
          createdAt: new Date().toISOString(),
        };

        await this.stripeService.createRefund(
          campaign.stripePaymentIntentId,
          refundAmount,
          'requested_by_customer',
          refundMetadata,
        );

        // Mettre à jour PlatformWallet
        const platformWallet = await this.prisma.platformWallet.findFirst();
        if (platformWallet) {
          await this.prisma.platformWallet.update({
            where: { id: platformWallet.id },
            data: {
              escrowBalance: { decrement: new Decimal(remainingAmount) },
              // Si frais d'annulation, ils restent comme commission
              commissionBalance: cancellationFee > 0
                ? { increment: new Decimal(cancellationFee) }
                : undefined,
              totalCommissions: cancellationFee > 0
                ? { increment: new Decimal(cancellationFee) }
                : undefined,
            },
          });
        }

        // Transaction refund
        await this.prisma.transaction.create({
          data: {
            walletId: null,
            type: 'CAMPAIGN_REFUND' as any,
            amount: new Decimal(refundAmount),
            reason: `PRO cancellation refund: ${campaign.title}${cancellationFee > 0 ? ` (fee: ${cancellationFee}€)` : ''}`,
            campaignId: id,
            status: 'COMPLETED' as any,
            metadata: {
              withinGracePeriod: !!withinGracePeriod,
              cancellationFee,
              completedSessions,
              remainingAmount,
            },
          },
        });
      }

      await this.prisma.campaign.update({
        where: { id },
        data: { status: CampaignStatus.CANCELLED },
      });

      await this.auditService.log(sellerId, AuditCategory.CAMPAIGN, 'CAMPAIGN_CANCELLED_REFUND', {
        campaignId: id,
        withinGracePeriod: !!withinGracePeriod,
        refundAmount,
        cancellationFee,
        completedSessions,
      });

      if (sellerProfile) {
        const feeMessage = cancellationFee > 0
          ? ` A cancellation fee of ${cancellationFee}€ was applied.`
          : '';
        await this.notificationsService.queueEmail({
          to: sellerProfile.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Campaign Cancelled',
          variables: {
            firstName: sellerProfile.firstName,
            campaignTitle: campaign.title,
            message: `Your campaign "${campaign.title}" has been cancelled. A refund of ${refundAmount}€ will be returned to your card.${feeMessage}`,
          },
          metadata: { campaignId: id, type: NotificationType.SYSTEM_ALERT },
        });
      }
      return;
    }

    // Fallback: statuts non gérés → simple soft delete
    await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.CANCELLED },
    });

    await this.auditService.log(sellerId, AuditCategory.CAMPAIGN, 'CAMPAIGN_CANCELLED', {
      campaignId: id,
      previousStatus: campaign.status,
    });
  }

  async activate(id: string, sellerId: string): Promise<CampaignResponseDto> {
    const campaign = await this.findOne(id);

    // Check ownership
    if (campaign.sellerId !== sellerId) {
      throw new ForbiddenException('You can only activate your own campaigns');
    }

    // Check if campaign is in DRAFT status
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT campaigns can be activated');
    }

    // PRO n'a PAS besoin de Stripe Connect ni de KYC
    // Le PRO paie simplement avec sa carte bancaire (pas de vérification nécessaire)
    // Les refunds seront automatiquement renvoyés sur sa carte via Stripe Refunds

    // Status → PENDING_PAYMENT
    await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.PENDING_PAYMENT },
    });

    // Get seller info for notification
    const sellerProfile = await this.prisma.profile.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        email: true,
        firstName: true,
      },
    });

    // Campaign activated (notification + audit)
    await this.auditService.log(
      sellerId,
      AuditCategory.CAMPAIGN,
      'CAMPAIGN_ACTIVATED',
      {
        campaignId: id,
        title: campaign.title,
        totalSlots: campaign.totalSlots,
      },
    );

    await this.notificationsService.queueEmail({
      to: sellerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Campaign Activated',
      variables: {
        firstName: sellerProfile!.firstName,
        campaignTitle: campaign.title,
        message: `Your campaign "${campaign.title}" has been activated successfully!`,
      },
      metadata: {
        campaignId: id,
        type: NotificationType.CAMPAIGN_CREATED,
      },
    });

    // Return updated campaign
    const updatedCampaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            avatar: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
          },
        },
        offers: true,
        procedures: {
          include: {
            steps: {
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
        distributions: true,
        criteria: true,
      },
    });

    return updatedCampaign as any;
  }
}
