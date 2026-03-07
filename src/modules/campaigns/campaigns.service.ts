import {
  Injectable,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
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
import { CampaignMarketplaceMode, CampaignStatus, AuditCategory, NotificationType, TesterTier, UserRole } from '@prisma/client';
import { GamificationService } from '../gamification/gamification.service';
import { isTierAtLeast, TIER_ORDER } from '../gamification/gamification.constants';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { Decimal } from '@prisma/client/runtime/library';
import { MediaService } from '../media/media.service';
import { normalizeImageEntry } from '../products/interfaces/product-image.interface';

const CAMPAIGN_FULL_INCLUDE = {
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
  offers: {
    include: {
      product: {
        select: {
          images: true,
        },
      },
    },
  },
  procedures: {
    include: {
      steps: {
        orderBy: { order: 'asc' as const },
      },
    },
    orderBy: { order: 'asc' as const },
  },
  distributions: true,
  criteria: true,
} as const;

const CAMPAIGN_LIST_INCLUDE = {
  ...CAMPAIGN_FULL_INCLUDE,
  _count: {
    select: {
      testSessions: true,
    },
  },
} as const;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private stripeService: StripeService,
    private businessRulesService: BusinessRulesService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
    private gamificationService: GamificationService,
    private mediaService: MediaService,
  ) {}

  /**
   * Supprime les champs sensibles d'une campagne avant de l'envoyer au frontend.
   * - isOwner = true (PRO qui possède la campagne, ou ADMIN) → garde escrowAmount, enlève Stripe IDs
   * - isOwner = false (testeur) → enlève escrowAmount, Stripe IDs, et masque expectedPrice si !isPriceRevealed
   */
  private sanitizeCampaign(campaign: any, isOwner: boolean): any {
    const {
      stripePaymentIntentId,
      stripeInvoiceId,
      stripeInvoiceUrl,
      paymentAuthorizedAt,
      paymentCapturedAt,
      activationGracePeriodEndsAt,
      cancelledBy,
      ...clean
    } = campaign;

    // Pour les testeurs, masquer aussi escrowAmount
    if (!isOwner) {
      delete clean.escrowAmount;
    }

    // Sanitiser les offres
    if (clean.offers) {
      clean.offers = clean.offers.map((offer: any) =>
        this.sanitizeOffer(offer, isOwner),
      );
    }

    return clean;
  }

  /**
   * Supprime les champs sensibles d'une offre.
   * - Si le PRO n'a pas révélé le prix (isPriceRevealed=false) et que ce n'est pas le owner,
   *   on masque expectedPrice, priceRangeMin, priceRangeMax, maxReimbursedPrice, maxReimbursedShipping
   */
  private sanitizeOffer(offer: any, isOwner: boolean): any {
    if (isOwner || offer.isPriceRevealed) {
      return offer;
    }

    const {
      expectedPrice,
      priceRangeMin,
      priceRangeMax,
      maxReimbursedPrice,
      maxReimbursedShipping,
      ...cleanOffer
    } = offer;

    return cleanOffer;
  }

  async create(
    sellerId: string,
    createDto: CreateCampaignDto,
  ): Promise<CampaignResponseDto> {
    // Validation 1: MarketplaceMode validation
    if (
      createDto.marketplaceMode === CampaignMarketplaceMode.PROCEDURES &&
      (!createDto.procedures || createDto.procedures.length === 0)
    ) {
      throw new I18nHttpException('campaign.procedures_required', 'CAMPAIGN_PROCEDURES_REQUIRED', HttpStatus.BAD_REQUEST);
    }

    if (
      createDto.marketplaceMode === CampaignMarketplaceMode.PRODUCT_LINK &&
      !createDto.amazonLink
    ) {
      throw new I18nHttpException('campaign.amazon_link_required', 'CAMPAIGN_LINK_REQUIRED', HttpStatus.BAD_REQUEST);
    }

    // Validation 2: Distributions validation
    if (!createDto.distributions || createDto.distributions.length === 0) {
      throw new I18nHttpException('campaign.distribution_date_required', 'CAMPAIGN_DISTRIBUTION_REQUIRED', HttpStatus.BAD_REQUEST);
    }

    let totalDistributionUnits = 0;
    for (const dist of createDto.distributions) {
      if (dist.type === 'RECURRING' && dist.dayOfWeek === undefined) {
        throw new I18nHttpException('campaign.day_of_week_required', 'CAMPAIGN_DAY_REQUIRED', HttpStatus.BAD_REQUEST);
      }
      if (dist.type === 'SPECIFIC_DATE' && !dist.specificDate) {
        throw new I18nHttpException('campaign.specific_date_required', 'CAMPAIGN_DATE_REQUIRED', HttpStatus.BAD_REQUEST);
      }
      totalDistributionUnits += dist.maxUnits;
    }

    if (totalDistributionUnits > createDto.totalSlots) {
      throw new I18nHttpException('campaign.distribution_exceeds_slots', 'CAMPAIGN_DISTRIBUTION_EXCEEDS_SLOTS', HttpStatus.BAD_REQUEST);
    }

    // Auto-calculate price range from business rules
    const rules = await this.businessRulesService.findLatest();
    const priceRange = this.calculatePriceRange(createDto.offer.expectedPrice, rules.priceRangeTiers);
    createDto.offer.priceRangeMin = priceRange.min;
    createDto.offer.priceRangeMax = priceRange.max;

    // Validation 3: Calculate escrow amount (basé sur les MAX remboursables)
    // Note: supertryCommission = commissionFixedFee (même frais, 5€)
    // On utilise seulement testerBonus ici car commissionFixedFee est ajouté par calculateCommission()
    const platformCommission = rules.testerBonus;

    const maxPrice = createDto.offer.maxReimbursedPrice ?? createDto.offer.expectedPrice;
    const maxShipping = createDto.offer.maxReimbursedShipping ?? createDto.offer.shippingCost;
    const proBonus = createDto.offer.bonus ?? 0;
    const costPerTester =
      (maxPrice +
        maxShipping +
        platformCommission +
        proBonus) *
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
              priceRangeMin: offer.priceRangeMin!,
              priceRangeMax: offer.priceRangeMax!,
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
        include: CAMPAIGN_FULL_INCLUDE,
      });

      return createdCampaign;
    });

    return this.sanitizeCampaign(campaign, true);
  }

  async findAll(
    filterDto: CampaignFilterDto,
    user?: { id: string; role: UserRole; tier?: TesterTier },
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

    // Endpoint testeur : sans filtre status, on ne montre que les campagnes ACTIVE
    const where: any = {
      status: status || CampaignStatus.ACTIVE,
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
      // Le filtre bonus est du point de vue testeur (bonus total = testerBonus(BR) + proBonus)
      // On soustrait testerBonus pour filtrer sur offer.bonus (qui est le proBonus)
      const bonusRules = await this.businessRulesService.findLatest();
      const testerFee = bonusRules.testerBonus;
      where.offers = {
        some: {
          bonus: {},
        },
      };
      if (minBonus !== undefined) {
        where.offers.some.bonus.gte = Math.max(0, minBonus - testerFee);
      }
      if (maxBonus !== undefined) {
        where.offers.some.bonus.lte = Math.max(0, maxBonus - testerFee);
      }
    }

    // Gamification: filtrer par tier pour les testeurs (USER)
    if (user?.role === UserRole.USER) {
      const testerTier = user.tier || TesterTier.BRONZE;
      const maxPrice = await this.gamificationService.getMaxProductPriceForTier(testerTier);

      // Filtrer les campagnes dont le prix produit est accessible au tier du testeur
      if (!where.offers) {
        where.offers = { some: {} };
      }
      if (!where.offers.some) {
        where.offers.some = {};
      }
      where.offers.some.expectedPrice = {
        ...where.offers.some.expectedPrice,
        lte: maxPrice,
      };

      // Exclure les campagnes qui exigent un palier supérieur au tier du testeur
      const testerTierIndex = TIER_ORDER.indexOf(testerTier);
      const higherTiers = TIER_ORDER.slice(testerTierIndex + 1);
      if (higherTiers.length > 0) {
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { criteria: null },
              { criteria: { minTier: null } },
              { criteria: { minTier: { in: TIER_ORDER.slice(0, testerTierIndex + 1) } } },
            ],
          },
        ];
      }
    }

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        skip,
        take: limit,
        include: CAMPAIGN_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    // Déterminer la participation du user pour chaque campagne
    let participatingCampaignIds = new Set<string>();
    if (user?.role === UserRole.USER) {
      const campaignIds = campaigns.map((c: any) => c.id);
      if (campaignIds.length > 0) {
        const userSessions = await this.prisma.testSession.findMany({
          where: {
            testerId: user.id,
            campaignId: { in: campaignIds },
          },
          select: { campaignId: true },
        });
        participatingCampaignIds = new Set(
          userSessions.map((s) => s.campaignId),
        );
      }
    }

    const alwaysClear =
      !user || user.role === UserRole.ADMIN;

    const campaignsWithImages = await Promise.all(
      campaigns.map(async (c: any) => {
        const isOwner = alwaysClear || (user?.role === UserRole.PRO && c.sellerId === user.id);
        const showClear =
          alwaysClear || participatingCampaignIds.has(c.id);
        const offersWithImages = await this.resolveOffersWithImages(
          c.offers || [],
          showClear,
        );
        return this.sanitizeCampaign({
          ...c,
          offers: offersWithImages,
          sessionsCount: c._count.testSessions,
        }, isOwner);
      }),
    );

    return createPaginatedResponse(campaignsWithImages, total, page, limit);
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
        include: CAMPAIGN_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    // PRO voit toujours ses images en clair
    const campaignsWithImages = await Promise.all(
      campaigns.map(async (c: any) => {
        const offersWithImages = await this.resolveOffersWithImages(
          c.offers || [],
          true,
        );
        return this.sanitizeCampaign({
          ...c,
          offers: offersWithImages,
          sessionsCount: c._count.testSessions,
        }, true);
      }),
    );

    return createPaginatedResponse(campaignsWithImages, total, page, limit);
  }

  async findOne(
    id: string,
    user?: { id: string; role: UserRole },
  ): Promise<CampaignResponseDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: CAMPAIGN_LIST_INCLUDE,
    });

    if (!campaign) {
      throw new I18nHttpException('campaign.not_found', 'CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Déterminer si on montre les images claires ou floues
    let showClear = true;
    if (user?.role === UserRole.USER) {
      const hasSession = await this.prisma.testSession.findFirst({
        where: {
          testerId: user.id,
          campaignId: id,
        },
        select: { id: true },
      });
      showClear = !!hasSession;
    }

    const offersWithImages = await this.resolveOffersWithImages(
      (campaign as any).offers || [],
      showClear,
    );

    const isOwner = !user || user.role === UserRole.ADMIN || (campaign as any).sellerId === user.id;

    const result = this.sanitizeCampaign({
      ...campaign,
      offers: offersWithImages,
      sessionsCount: (campaign as any)._count.testSessions,
    }, isOwner);

    if (isOwner && campaign.escrowAmount && Number(campaign.escrowAmount) > 0) {
      try {
        result.pricingBreakdown = await this.paymentsService.calculateCampaignEscrow(id);
      } catch {}
    }

    return result;
  }

  async checkEligibility(
    campaignId: string,
    testerId: string,
  ): Promise<CheckEligibilityResponseDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        criteria: true,
        offers: true,
        testSessions: {
          where: { testerId },
        },
      },
    });

    if (!campaign) {
      throw new I18nHttpException('campaign.not_found', 'CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
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
      throw new I18nHttpException('campaign.tester_not_found', 'TESTER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const reasons: string[] = [];
    const criteria = campaign.criteria;

    // Check criteria-based eligibility (only if criteria exist)
    if (criteria) {

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

    } // end if (criteria)

    // Gamification: vérification tier vs prix produit
    const offer = campaign.offers?.[0];
    if (offer) {
      const tierCheck = await this.gamificationService.checkTierEligibility(
        testerId,
        Number(offer.expectedPrice),
      );
      if (!tierCheck.eligible) {
        reasons.push(tierCheck.reason!);
      }
    }

    // Gamification: vérification palier minimum défini par le vendeur
    if (criteria?.minTier) {
      const testerTier = tester.tier || TesterTier.BRONZE;
      if (!isTierAtLeast(testerTier, criteria.minTier as TesterTier)) {
        reasons.push(`Palier minimum requis : ${criteria.minTier}`);
      }
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

  /**
   * Résout les images produit pour chaque offer d'une campagne.
   * Retourne les signed URLs (floues ou claires selon showClear).
   */
  private async resolveOffersWithImages(
    offers: any[],
    showClear: boolean,
  ): Promise<any[]> {
    return Promise.all(
      offers.map(async (offer: any) => {
        const productImages: any[] = Array.isArray(offer.product?.images)
          ? offer.product.images
          : [];

        const normalized = productImages.map(normalizeImageEntry);
        const keys = normalized.map((entry) => {
          const key = showClear ? entry.clearKey : entry.blurredKey;
          if (key.startsWith('http://') || key.startsWith('https://')) {
            return this.mediaService.extractKeyFromUrl(key) ?? key;
          }
          return key;
        });

        const signedUrls =
          keys.length > 0 ? await this.mediaService.getSignedUrls(keys) : [];

        // Retourner l'offer sans le champ product brut
        const { product, ...offerData } = offer;
        return {
          ...offerData,
          productImages: signedUrls,
        };
      }),
    );
  }

  /**
   * Calcule automatiquement la fourchette de prix à partir du expectedPrice
   * et des paliers définis dans BusinessRules.priceRangeTiers.
   *
   * Logique : tranches fixes par palier. Le prix est arrondi au plancher
   * du multiple de `step`, puis min = plancher, max = plancher + step.
   *
   * Paliers par défaut:
   *   0-50€   → step 5€   : 23€ → 20-25€, 7€ → 5-10€, 49€ → 45-50€
   *   50-100€ → step 10€  : 86€ → 80-90€, 53€ → 50-60€
   *   100-200€→ step 25€  : 145€ → 125-150€, 180€ → 175-200€
   *   200€+   → step 50€  : 230€ → 200-250€, 310€ → 300-350€
   */
  private calculatePriceRange(
    expectedPrice: number,
    priceRangeTiers: any,
  ): { min: number; max: number } {
    const tiers = (typeof priceRangeTiers === 'string'
      ? JSON.parse(priceRangeTiers)
      : priceRangeTiers) as Array<{ maxPrice: number; step: number }>;

    // Trouver le palier correspondant au prix
    const sortedTiers = [...tiers].sort((a, b) => a.maxPrice - b.maxPrice);
    const tier = sortedTiers.find((t) => expectedPrice <= t.maxPrice)
      || sortedTiers[sortedTiers.length - 1];

    const { step } = tier;

    // Plancher = plus grand multiple de step inférieur ou égal au prix
    const min = Math.max(0, Math.floor(expectedPrice / step) * step);
    const max = min + step;

    return { min, max };
  }

  async update(
    id: string,
    sellerId: string,
    updateDto: UpdateCampaignDto,
  ): Promise<CampaignResponseDto> {
    const campaign = await this.findOne(id);

    // Check ownership
    if (campaign.sellerId !== sellerId) {
      throw new I18nHttpException('campaign.not_owner', 'CAMPAIGN_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check if campaign can be updated (not ACTIVE with sessions)
    if (
      campaign.status === CampaignStatus.ACTIVE &&
      campaign.sessionsCount &&
      campaign.sessionsCount > 0
    ) {
      throw new I18nHttpException('campaign.cannot_update_active_sessions', 'CAMPAIGN_CANNOT_UPDATE', HttpStatus.BAD_REQUEST);
    }

    // Recalculate price range if offer changes
    if (updateDto.offer?.expectedPrice) {
      const rules = await this.businessRulesService.findLatest();
      const priceRange = this.calculatePriceRange(updateDto.offer.expectedPrice, rules.priceRangeTiers);
      updateDto.offer.priceRangeMin = priceRange.min;
      updateDto.offer.priceRangeMax = priceRange.max;
    }

    // Recalculate escrow if offer changes (basé sur les MAX remboursables)
    let escrowAmount = campaign.escrowAmount;
    if (updateDto.offer || updateDto.totalSlots) {
      const offer = updateDto.offer || campaign.offers[0];
      const totalSlots = updateDto.totalSlots || campaign.totalSlots;

      const rules = await this.businessRulesService.findLatest();
      // Note: supertryCommission = commissionFixedFee (même frais, 5€)
      // On utilise seulement testerBonus ici car commissionFixedFee est ajouté par calculateCommission()
      const platformCommission = rules.testerBonus;

      const maxPrice = Number(offer.maxReimbursedPrice ?? offer.expectedPrice);
      const maxShipping = Number(offer.maxReimbursedShipping ?? offer.shippingCost);
      const proBonus = Number(offer.bonus ?? 0);
      const costPerTester =
        (maxPrice +
          maxShipping +
          platformCommission +
          proBonus) *
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
      include: CAMPAIGN_FULL_INCLUDE,
    });

    return this.sanitizeCampaign(updatedCampaign, true);
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
      throw new I18nHttpException('campaign.not_found', 'CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (campaign.sellerId !== sellerId) {
      throw new I18nHttpException('campaign.not_owner', 'CAMPAIGN_NOT_OWNER', HttpStatus.FORBIDDEN);
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
        throw new I18nHttpException('campaign.cannot_cancel_active_sessions', 'CAMPAIGN_CANNOT_CANCEL_SESSIONS', HttpStatus.BAD_REQUEST, { count: activeSessions });
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
      throw new I18nHttpException('campaign.not_owner', 'CAMPAIGN_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check if campaign is in DRAFT status
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new I18nHttpException('campaign.only_draft_activate', 'CAMPAIGN_ONLY_DRAFT', HttpStatus.BAD_REQUEST);
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
      include: CAMPAIGN_FULL_INCLUDE,
    });

    return this.sanitizeCampaign(updatedCampaign, true);
  }
}
