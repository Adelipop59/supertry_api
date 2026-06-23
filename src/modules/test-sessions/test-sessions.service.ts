import {
  Injectable,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
import { PrismaService } from '../../database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { ApplyToCampaignDto } from './dto/apply-campaign.dto';
import { ValidatePriceDto } from './dto/validate-price.dto';
import { SubmitPurchaseDto } from './dto/submit-purchase.dto';
import { ValidatePurchaseDto } from './dto/validate-purchase.dto';
import { CompleteStepDto } from './dto/complete-step.dto';
import { CancelSessionDto } from './dto/cancel-session.dto';
import { RescheduleSessionDto } from './dto/reschedule-session.dto';
import { RejectSessionDto } from './dto/reject-session.dto';
import { RejectPurchaseDto } from './dto/reject-purchase.dto';
import { TestSessionResponseDto } from './dto/test-session-response.dto';
import { TestSessionFilterDto } from './dto/test-session-filter.dto';
import {
  PaginatedResponse,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { SessionStatus, CampaignMarketplaceMode, AuditCategory, TesterTier, CampaignStatus } from '@prisma/client';
import { GamificationService } from '../gamification/gamification.service';
import { isTierAtLeast } from '../gamification/gamification.constants';
import { MessagesService } from '../messages/messages.service';
import { MediaService } from '../media/media.service';
import { PostHogService } from '../posthog/posthog.service';
import { normalizeImageEntry } from '../products/interfaces/product-image.interface';
import { computeSpendCeiling } from '../../common/utils/pricing.util';

const CAMPAIGN_OFFERS_WITH_IMAGES = {
  offers: {
    include: {
      product: {
        select: { images: true, price: true },
      },
    },
  },
} as const;

const SESSION_INCLUDE = {
  campaign: {
    select: {
      id: true,
      title: true,
      marketplaceMode: true,
      seller: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
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
      ...CAMPAIGN_OFFERS_WITH_IMAGES,
    },
  },
  tester: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
    },
  },
  stepProgress: {
    include: {
      step: {
        select: {
          id: true,
          title: true,
          type: true,
          order: true,
        },
      },
    },
  },
} as const;

const SESSION_BASIC_INCLUDE = {
  campaign: {
    select: {
      id: true,
      title: true,
      seller: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      ...CAMPAIGN_OFFERS_WITH_IMAGES,
    },
  },
  tester: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
    },
  },
  stepProgress: {
    include: {
      step: {
        select: {
          id: true,
          title: true,
          type: true,
          order: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class TestSessionsService {
  private readonly logger = new Logger(TestSessionsService.name);

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private stripeService: StripeService,
    private auditService: AuditService,
    private businessRulesService: BusinessRulesService,
    private gamificationService: GamificationService,
    private messagesService: MessagesService,
    private mediaService: MediaService,
    private posthog: PostHogService,
  ) {}

  async apply(
    campaignId: string,
    testerId: string,
    dto: ApplyToCampaignDto,
  ): Promise<TestSessionResponseDto> {
    // Check if campaign exists and is active
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        criteria: true,
        offers: true,
        distributions: {
          where: { isActive: true },
        },
      },
    });

    if (!campaign) {
      throw new I18nHttpException('campaign.not_found', 'CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (campaign.status !== 'ACTIVE') {
      throw new I18nHttpException('campaign.not_active', 'CAMPAIGN_NOT_ACTIVE', HttpStatus.BAD_REQUEST);
    }

    // Check available slots
    if (campaign.availableSlots <= 0) {
      throw new I18nHttpException('campaign.no_slots', 'CAMPAIGN_NO_SLOTS', HttpStatus.BAD_REQUEST);
    }

    // Check if tester is banned
    const tester = await this.prisma.profile.findUnique({
      where: { id: testerId },
      select: {
        id: true,
        bannedUntil: true,
        stripeConnectAccountId: true,
        stripeOnboardingCompleted: true,
        stripeIdentityVerified: true,
        completedSessionsCount: true,
        tier: true,
        verificationStatus: true,
      },
    });

    if (tester?.bannedUntil && tester.bannedUntil > new Date()) {
      throw new I18nHttpException('session.banned_until', 'SESSION_BANNED', HttpStatus.BAD_REQUEST, { date: tester.bannedUntil?.toLocaleDateString() || '' });
    }

    // Vérification incohérence identité (Connect vs Identity KYC)
    if (tester?.verificationStatus === 'INCOHERENT') {
      throw new I18nHttpException('session.identity_blocked', 'SESSION_IDENTITY_BLOCKED', HttpStatus.BAD_REQUEST, undefined, { verificationBlocked: true });
    }

    // Vérification onboarding + KYC conditionnel
    // SKIP_KYC_VERIFICATION ne peut PAS bypass le KYC en production
    const skipKYC =
      process.env.NODE_ENV !== 'production' &&
      process.env.SKIP_KYC_VERIFICATION === 'true';

    if (!skipKYC) {
      // 1. Stripe Connect créé ?
      if (!tester?.stripeConnectAccountId) {
        throw new I18nHttpException('session.stripe_required', 'SESSION_STRIPE_REQUIRED', HttpStatus.BAD_REQUEST, undefined, { identityRequired: true });
      }

      // 2. Onboarding Connect complété (IBAN, infos perso) ?
      if (!tester.stripeOnboardingCompleted) {
        throw new I18nHttpException('session.onboarding_required', 'SESSION_ONBOARDING_REQUIRED', HttpStatus.BAD_REQUEST, undefined, { onboardingRequired: true });
      }

      // 3. KYC Identity obligatoire seulement après N tests réussis
      const rules = await this.businessRulesService.findLatest();
      const kycThreshold = rules.kycRequiredAfterTests ?? 3;

      if (tester.completedSessionsCount >= kycThreshold && !tester.stripeIdentityVerified) {
        const verificationSession =
          await this.stripeService.createIdentityVerificationSession(
            testerId,
            `${process.env.FRONTEND_URL}/dashboard/identity/callback`,
          );

        throw new I18nHttpException('session.kyc_required', 'SESSION_KYC_REQUIRED', HttpStatus.BAD_REQUEST, { threshold: kycThreshold }, { identityRequired: true, verificationUrl: verificationSession.url, clientSecret: verificationSession.clientSecret });
      }
    } else {
      console.warn('⚠️  KYC verification skipped (SKIP_KYC_VERIFICATION=true)');
    }

    // Gamification: vérification tier vs prix produit
    const offer = campaign.offers?.[0];
    if (offer && tester) {
      const tierCheck = await this.gamificationService.checkTierEligibility(
        testerId,
        Number(offer.expectedPrice),
      );
      if (!tierCheck.eligible) {
        throw new I18nHttpException('session.tier_insufficient', 'SESSION_TIER_INSUFFICIENT', HttpStatus.BAD_REQUEST);
      }

      // Vérification palier minimum défini par le vendeur
      if (campaign.criteria?.minTier) {
        if (!isTierAtLeast(tester.tier, campaign.criteria.minTier as TesterTier)) {
          throw new I18nHttpException('session.criteria_not_met', 'SESSION_CRITERIA_NOT_MET', HttpStatus.BAD_REQUEST, { requiredTier: campaign.criteria.minTier, currentTier: tester.tier });
        }
      }
    }

    // Calculate scheduled purchase date (honore la date choisie par le testeur si fournie)
    const scheduledPurchaseDate = await this.resolveScheduledPurchaseDate(
      campaignId,
      campaign.distributions,
      dto.distributionId,
    );
    void scheduledPurchaseDate; // validation anticipée ; la date définitive est recalculée dans la transaction

    // Create test session with pessimistic locking to prevent race conditions
    const session = await this.prisma.$transaction(async (tx) => {
      // Lock the campaign row to prevent concurrent slot allocation
      const [lockedCampaign] = await tx.$queryRaw<any[]>`
        SELECT "available_slots" FROM "campaigns"
        WHERE "id" = ${campaignId}
        FOR UPDATE
      `;

      if (!lockedCampaign || lockedCampaign.available_slots <= 0) {
        throw new I18nHttpException('campaign.no_slots', 'CAMPAIGN_NO_SLOTS', HttpStatus.BAD_REQUEST);
      }

      // Re-calculate scheduled date inside transaction to prevent double-booking
      const distributions = await tx.distribution.findMany({
        where: { campaignId, isActive: true },
      });

      const txScheduledDate = await this.resolveScheduledPurchaseDateTx(
        tx,
        campaignId,
        distributions,
        dto.distributionId,
      );

      // Decrement available slots
      await tx.campaign.update({
        where: { id: campaignId },
        data: {
          availableSlots: { decrement: 1 },
        },
      });

      // Create session
      const createdSession = await tx.testSession.create({
        data: {
          campaignId,
          testerId,
          status: campaign.autoAcceptApplications
            ? SessionStatus.ACCEPTED
            : SessionStatus.PENDING,
          applicationMessage: dto.applicationMessage,
          scheduledPurchaseDate: txScheduledDate,
          acceptedAt: campaign.autoAcceptApplications ? new Date() : null,
        },
        include: SESSION_BASIC_INCLUDE,
      });

      return createdSession;
    });

    this.posthog.capture(testerId, 'campaign_applied', {
      sessionId: session.id,
      campaignId,
      autoAccepted: campaign.autoAcceptApplications,
      status: session.status,
    });

    return session as any;
  }

  /** Résout la date concrète d'une distribution (prochaine occurrence pour RECURRING). */
  private resolveDistributionDate(dist: any): Date {
    if (dist.type === 'RECURRING') {
      return this.getNextDayOfWeek(new Date(), dist.dayOfWeek);
    }
    return new Date(dist.specificDate);
  }

  /**
   * Résout la scheduledPurchaseDate : si le testeur a choisi une distribution, on l'utilise
   * (après vérif capacité) ; sinon on auto-assigne la prochaine date disponible.
   */
  private async resolveScheduledPurchaseDate(
    campaignId: string,
    distributions: any[],
    distributionId?: string,
  ): Promise<Date> {
    if (!distributionId) {
      return this.calculateScheduledPurchaseDate(campaignId, distributions);
    }
    const dist = distributions.find(
      (d) => d.id === distributionId && d.isActive,
    );
    if (!dist) {
      throw new I18nHttpException(
        'session.distribution_invalid',
        'SESSION_DISTRIBUTION_INVALID',
        HttpStatus.BAD_REQUEST,
      );
    }
    const date = this.resolveDistributionDate(dist);
    const count = await this.prisma.testSession.count({
      where: {
        campaignId,
        scheduledPurchaseDate: date,
        status: { notIn: [SessionStatus.CANCELLED, SessionStatus.REJECTED] },
      },
    });
    if (count >= dist.maxUnits) {
      throw new I18nHttpException(
        'campaign.no_slots',
        'CAMPAIGN_NO_SLOTS',
        HttpStatus.BAD_REQUEST,
      );
    }
    return date;
  }

  /** Version transactionnelle de resolveScheduledPurchaseDate. */
  private async resolveScheduledPurchaseDateTx(
    tx: any,
    campaignId: string,
    distributions: any[],
    distributionId?: string,
    excludeSessionId?: string,
  ): Promise<Date> {
    if (!distributionId) {
      return this.calculateScheduledPurchaseDateTx(tx, campaignId, distributions);
    }
    const dist = distributions.find(
      (d) => d.id === distributionId && d.isActive,
    );
    if (!dist) {
      throw new I18nHttpException(
        'session.distribution_invalid',
        'SESSION_DISTRIBUTION_INVALID',
        HttpStatus.BAD_REQUEST,
      );
    }
    const date = this.resolveDistributionDate(dist);
    const count = await tx.testSession.count({
      where: {
        campaignId,
        scheduledPurchaseDate: date,
        status: { notIn: [SessionStatus.CANCELLED, SessionStatus.REJECTED] },
        ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      },
    });
    if (count >= dist.maxUnits) {
      throw new I18nHttpException(
        'campaign.no_slots',
        'CAMPAIGN_NO_SLOTS',
        HttpStatus.BAD_REQUEST,
      );
    }
    return date;
  }

  private async calculateScheduledPurchaseDate(
    campaignId: string,
    distributions: any[],
  ): Promise<Date> {
    const now = new Date();
    let nearestDate: Date | null = null;

    for (const dist of distributions) {
      if (!dist.isActive) continue;

      let candidateDate: Date;

      if (dist.type === 'RECURRING') {
        candidateDate = this.getNextDayOfWeek(now, dist.dayOfWeek);
      } else if (dist.type === 'SPECIFIC_DATE') {
        candidateDate = new Date(dist.specificDate);
      } else {
        continue;
      }

      // Check if max units not reached for this date
      const sessionsOnDate = await this.prisma.testSession.count({
        where: {
          campaignId,
          scheduledPurchaseDate: candidateDate,
          status: {
            notIn: [SessionStatus.CANCELLED, SessionStatus.REJECTED],
          },
        },
      });

      if (sessionsOnDate >= dist.maxUnits) continue;

      // Keep the nearest date
      if (!nearestDate || candidateDate < nearestDate) {
        nearestDate = candidateDate;
      }
    }

    if (!nearestDate) {
      throw new I18nHttpException('campaign.no_slots', 'CAMPAIGN_NO_SLOTS', HttpStatus.BAD_REQUEST);
    }

    return nearestDate;
  }

  /**
   * Version transactionnelle de calculateScheduledPurchaseDate.
   * Utilise le client tx pour compter les sessions, garantissant la cohérence
   * grâce au lock FOR UPDATE sur la campagne.
   */
  private async calculateScheduledPurchaseDateTx(
    tx: any,
    campaignId: string,
    distributions: any[],
  ): Promise<Date> {
    const now = new Date();
    let nearestDate: Date | null = null;

    for (const dist of distributions) {
      if (!dist.isActive) continue;

      let candidateDate: Date;

      if (dist.type === 'RECURRING') {
        candidateDate = this.getNextDayOfWeek(now, dist.dayOfWeek);
      } else if (dist.type === 'SPECIFIC_DATE') {
        candidateDate = new Date(dist.specificDate);
      } else {
        continue;
      }

      // Count within the transaction to get accurate numbers
      const sessionsOnDate = await tx.testSession.count({
        where: {
          campaignId,
          scheduledPurchaseDate: candidateDate,
          status: {
            notIn: [SessionStatus.CANCELLED, SessionStatus.REJECTED],
          },
        },
      });

      if (sessionsOnDate >= dist.maxUnits) continue;

      if (!nearestDate || candidateDate < nearestDate) {
        nearestDate = candidateDate;
      }
    }

    if (!nearestDate) {
      throw new I18nHttpException('campaign.no_slots', 'CAMPAIGN_NO_SLOTS', HttpStatus.BAD_REQUEST);
    }

    return nearestDate;
  }

  private getNextDayOfWeek(from: Date, targetDayOfWeek: number): Date {
    const result = new Date(from);
    const currentDay = result.getDay();
    const distance = (targetDayOfWeek - currentDay + 7) % 7;
    result.setDate(result.getDate() + (distance === 0 ? 7 : distance));
    return result;
  }

  async accept(
    sessionId: string,
    sellerId: string,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.campaign.seller.id !== sellerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status
    if (session.status !== SessionStatus.PENDING) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Count total steps across all procedures for this campaign
    const totalSteps = await this.prisma.step.count({
      where: {
        procedure: { campaignId: session.campaignId },
      },
    });

    // If no steps, skip directly to PROCEDURES_COMPLETED
    const acceptStatus = totalSteps === 0
      ? SessionStatus.PROCEDURES_COMPLETED
      : SessionStatus.ACCEPTED;

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: acceptStatus,
        acceptedAt: new Date(),
      },
      include: SESSION_INCLUDE,
    });

    // Create system message to initiate the chat
    await this.messagesService.createSystemMessage(
      sessionId,
      'Candidature acceptée ! Vous pouvez maintenant échanger par message.',
    );

    return updatedSession as any;
  }

  async reject(
    sessionId: string,
    sellerId: string,
    dto: RejectSessionDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.campaign.seller.id !== sellerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status
    if (session.status !== SessionStatus.PENDING) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    const updatedSession = await this.prisma.$transaction(async (tx) => {
      // Increment available slots
      await tx.campaign.update({
        where: { id: session.campaignId },
        data: {
          availableSlots: { increment: 1 },
        },
      });

      // Update session
      return await tx.testSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: dto.rejectionReason,
        },
        include: SESSION_BASIC_INCLUDE,
      });
    });

    return updatedSession as any;
  }

  async cancel(
    sessionId: string,
    testerId: string,
    dto: CancelSessionDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.testerId !== testerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status - can cancel PENDING, ACCEPTED, PRICE_VALIDATED, PURCHASE_REJECTED, or PURCHASE_VALIDATED
    const cancellableStatuses: SessionStatus[] = [
      SessionStatus.PENDING,
      SessionStatus.ACCEPTED,
      SessionStatus.PRICE_VALIDATED,
      SessionStatus.PURCHASE_REJECTED,
      SessionStatus.PURCHASE_VALIDATED,
    ];

    if (!cancellableStatuses.includes(session.status)) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Get business rules
    const businessRules = await this.businessRulesService.findLatest();

    const gracePeriodMinutes =
      businessRules?.campaignActivationGracePeriodMinutes || 60;
    const banDays = businessRules?.testerCancellationBanDays || 14;

    // Lecture du compteur d'annulations existant : le ban ne s'applique qu'à
    // partir de la 2ème annulation hors grâce (la 1ère est seulement comptée).
    const testerProfile = await this.prisma.profile.findUnique({
      where: { id: testerId },
      select: { cancellationCount: true },
    });
    const priorCancellationCount = testerProfile?.cancellationCount ?? 0;

    // Check if within grace period (depuis acceptation)
    const acceptedAt = session.acceptedAt || session.appliedAt;
    const now = new Date();
    const minutesSinceAcceptance =
      (now.getTime() - acceptedAt.getTime()) / (1000 * 60);

    const withinGracePeriod = minutesSinceAcceptance <= gracePeriodMinutes;

    // Déterminer si remboursement nécessaire
    const needsRefund = session.status === SessionStatus.PURCHASE_VALIDATED;

    this.logger.log(
      `Tester ${testerId} cancelling session ${sessionId} (status: ${session.status}, withinGracePeriod: ${withinGracePeriod}, needsRefund: ${needsRefund})`,
    );

    // Si remboursement nécessaire, le traiter AVANT la transaction
    if (needsRefund) {
      await this.paymentsService.processSessionCancellationRefund(sessionId);
    }

    // Update session and tester in transaction
    const updatedSession = await this.prisma.$transaction(async (tx) => {
      // Increment available slots
      await tx.campaign.update({
        where: { id: session.campaignId },
        data: {
          availableSlots: { increment: 1 },
        },
      });

      // Hors grace period : on compte toujours l'annulation, mais le ban
      // (14 jours) ne s'active qu'à partir de la 2ème annulation.
      if (!withinGracePeriod) {
        // priorCancellationCount >= 1 signifie que c'est au moins la 2ème.
        const shouldBan = priorCancellationCount >= 1;
        const bannedUntil = shouldBan ? new Date() : null;
        if (bannedUntil) {
          bannedUntil.setDate(bannedUntil.getDate() + banDays);
        }

        await tx.profile.update({
          where: { id: testerId },
          data: {
            cancellationCount: { increment: 1 },
            lastCancellationAt: now,
            ...(bannedUntil ? { bannedUntil } : {}),
          },
        });

        if (bannedUntil) {
          this.logger.log(
            `Tester ${testerId} banned until ${bannedUntil.toISOString()} (${banDays} days, cancellation #${priorCancellationCount + 1})`,
          );
        } else {
          this.logger.log(
            `Tester ${testerId} first post-grace cancellation — counted, no ban applied`,
          );
        }
      }

      // Update session
      return await tx.testSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.CANCELLED,
          cancelledAt: now,
          cancellationReason: dto.cancellationReason,
        },
        include: SESSION_BASIC_INCLUDE,
      });
    });

    // Audit
    await this.auditService.log(
      testerId,
      AuditCategory.SESSION,
      'SESSION_CANCELLED_BY_TESTER',
      {
        sessionId,
        campaignId: session.campaignId,
        status: session.status,
        withinGracePeriod,
        needsRefund,
        reason: dto.cancellationReason,
      },
    );

    return updatedSession as any;
  }

  /**
   * Permet au testeur de changer la date (créneau) de sa session, avant l'achat.
   * Gratuit et sans pénalité — alternative à l'annulation.
   */
  async reschedule(
    sessionId: string,
    testerId: string,
    dto: RescheduleSessionDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.testerId !== testerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Reschedule autorisé uniquement avant l'achat
    const reschedulableStatuses: SessionStatus[] = [
      SessionStatus.PENDING,
      SessionStatus.ACCEPTED,
      SessionStatus.PRICE_VALIDATED,
    ];
    if (!reschedulableStatuses.includes(session.status)) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    const updatedSession = await this.prisma.$transaction(async (tx) => {
      const distributions = await tx.distribution.findMany({
        where: { campaignId: session.campaignId, isActive: true },
      });

      // Valide le créneau + capacité (en excluant la session courante) et
      // calcule la nouvelle date.
      const newDate = await this.resolveScheduledPurchaseDateTx(
        tx,
        session.campaignId,
        distributions,
        dto.distributionId,
        sessionId,
      );

      return tx.testSession.update({
        where: { id: sessionId },
        data: { scheduledPurchaseDate: newDate },
        include: SESSION_BASIC_INCLUDE,
      });
    });

    // Audit
    await this.auditService.log(
      testerId,
      AuditCategory.SESSION,
      'SESSION_RESCHEDULED_BY_TESTER',
      {
        sessionId,
        campaignId: session.campaignId,
        distributionId: dto.distributionId,
        newScheduledPurchaseDate: updatedSession.scheduledPurchaseDate,
      },
    );

    return updatedSession as any;
  }

  async validatePrice(
    sessionId: string,
    testerId: string,
    dto: ValidatePriceDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.testerId !== testerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Get campaign and offer first to check mode
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: session.campaignId },
      include: {
        offers: true,
      },
    });

    // Check marketplace mode - price validation only for PROCEDURES mode
    if (campaign?.marketplaceMode === CampaignMarketplaceMode.PRODUCT_LINK) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Check status - must have completed all procedures first (for PROCEDURES mode)
    if (session.status !== SessionStatus.PROCEDURES_COMPLETED) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Guard: vérifier que c'est le jour prévu par la distribution
    this.assertScheduledDateIsToday(session);

    const offer = campaign?.offers[0];
    if (!offer) {
      throw new I18nHttpException('session.offer_not_found', 'SESSION_OFFER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Validate price range
    const priceInRange =
      dto.productPrice >= Number(offer.priceRangeMin) &&
      dto.productPrice <= Number(offer.priceRangeMax);

    if (priceInRange) {
      // Price is correct
      const updatedSession = await this.prisma.testSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.PRICE_VALIDATED,
          validatedProductPrice: dto.productPrice,
          priceValidatedAt: new Date(),
        },
        include: SESSION_BASIC_INCLUDE,
      });

      return updatedSession as any;
    } else {
      // Price is incorrect
      const attempts = session.priceValidationAttempts + 1;

      if (attempts >= 2) {
        // After 2 failed attempts, ask for product title
        throw new I18nHttpException('session.price_invalid', 'SESSION_PRICE_INVALID', HttpStatus.BAD_REQUEST);
      }

      await this.prisma.testSession.update({
        where: { id: sessionId },
        data: {
          priceValidationAttempts: attempts,
        },
      });

      throw new I18nHttpException('session.price_invalid', 'SESSION_PRICE_INVALID', HttpStatus.BAD_REQUEST, { min: offer.priceRangeMin, max: offer.priceRangeMax, attempts });
    }
  }

  async submitPurchase(
    sessionId: string,
    testerId: string,
    dto: SubmitPurchaseDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.testerId !== testerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status - depends on marketplace mode
    const campaign = session.campaign;

    if (campaign.marketplaceMode === CampaignMarketplaceMode.PRODUCT_LINK) {
      // PRODUCT_LINK: can submit purchase directly after acceptance or after rejection
      const validStatuses: SessionStatus[] = [SessionStatus.ACCEPTED, SessionStatus.PURCHASE_REJECTED];
      if (!validStatuses.includes(session.status)) {
        throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
      }
    } else {
      // PROCEDURES: must complete procedures and validate price first, or resubmit after rejection
      const validStatuses: SessionStatus[] = [SessionStatus.PRICE_VALIDATED, SessionStatus.PURCHASE_REJECTED];
      if (!validStatuses.includes(session.status)) {
        throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
      }
    }

    // Validate price against max reimbursement limits
    const offer = await this.prisma.offer.findFirst({
      where: { campaignId: campaign.id },
      select: { expectedPrice: true, shippingCost: true, maxReimbursedPrice: true, maxReimbursedShipping: true },
    });
    if (offer) {
      const maxPrice = Number(offer.maxReimbursedPrice ?? offer.expectedPrice);
      const maxShipping = Number(offer.maxReimbursedShipping ?? offer.shippingCost);

      if (dto.productPrice > maxPrice) {
        throw new I18nHttpException('session.price_exceeds_max', 'SESSION_PRICE_EXCEEDS_MAX', HttpStatus.BAD_REQUEST, { max: maxPrice });
      }
      if (dto.shippingCost > maxShipping) {
        throw new I18nHttpException('session.shipping_exceeds_max', 'SESSION_SHIPPING_EXCEEDS_MAX', HttpStatus.BAD_REQUEST, { max: maxShipping });
      }
    }

    // Check scheduled purchase date (allow ±1 day tolerance)
    // BYPASS_BUSINESS_RULES is dev-only — production must always enforce the date guard.
    const bypassBusinessRules =
      process.env.NODE_ENV !== 'production' &&
      process.env.BYPASS_BUSINESS_RULES === 'true';

    if (session.scheduledPurchaseDate && !bypassBusinessRules) {
      const today = new Date();
      const scheduled = new Date(session.scheduledPurchaseDate);
      const diffDays = Math.abs(
        (today.getTime() - scheduled.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays > 1) {
        throw new I18nHttpException('session.purchase_date_invalid', 'SESSION_PURCHASE_DATE_INVALID', HttpStatus.BAD_REQUEST, { date: scheduled.toISOString().split('T')[0] });
      }
    }

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.PURCHASE_SUBMITTED,
        orderNumber: dto.orderNumber,
        productPrice: dto.productPrice,
        shippingCost: dto.shippingCost,
        purchaseProofKeys: dto.purchaseProofKeys,
        purchasedAt: new Date(),
      },
      include: SESSION_INCLUDE,
    });

    this.posthog.capture(testerId, 'purchase_submitted', {
      sessionId,
      campaignId: campaign.id,
      productPrice: dto.productPrice,
      shippingCost: dto.shippingCost,
    });

    return updatedSession as any;
  }

  async validatePurchase(
    sessionId: string,
    sellerId: string,
    dto?: ValidatePurchaseDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.campaign.seller.id !== sellerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status
    if (session.status !== SessionStatus.PURCHASE_SUBMITTED) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Apply PRO overrides (productPrice / shippingCost / comment) BEFORE the transfer,
    // since processPurchaseReimbursement reads them from the DB. Status stays
    // PURCHASE_SUBMITTED until the payment succeeds.
    const priceUpdates: Record<string, unknown> = {};
    if (dto?.productPrice !== undefined) {
      priceUpdates.productPrice = dto.productPrice;
    }
    if (dto?.shippingCost !== undefined) {
      priceUpdates.shippingCost = dto.shippingCost;
    }
    if (dto?.purchaseValidationComment) {
      priceUpdates.purchaseValidationComment = dto.purchaseValidationComment;
    }
    if (Object.keys(priceUpdates).length > 0) {
      await this.prisma.testSession.update({
        where: { id: sessionId },
        data: priceUpdates,
      });
    }

    // Process purchase reimbursement BEFORE flipping the status.
    // If it throws, the session stays PURCHASE_SUBMITTED and the PRO can retry.
    // If it succeeds but the next update crashes, retry is still safe because
    // processPurchaseReimbursement is idempotent via session.purchaseReimbursedAt.
    try {
      await this.paymentsService.processPurchaseReimbursement(sessionId);
    } catch (error) {
      this.logger.error(`Failed to process purchase reimbursement for session ${sessionId}: ${error.message}`);
      throw new I18nHttpException(
        'payment.reimbursement_failed',
        'PAYMENT_REIMBURSEMENT_FAILED',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Payment succeeded → mark session as validated.
    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.PURCHASE_VALIDATED,
        purchaseValidatedAt: new Date(),
      },
      include: SESSION_INCLUDE,
    });

    this.posthog.capture(sellerId, 'purchase_validated', {
      sessionId,
      campaignId: session.campaign.id,
      testerId: session.testerId,
    });

    return updatedSession as any;
  }

  async rejectPurchase(
    sessionId: string,
    sellerId: string,
    dto: RejectPurchaseDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.campaign.seller.id !== sellerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status
    if (session.status !== SessionStatus.PURCHASE_SUBMITTED) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Save the rejected purchase attempt in history
    await this.prisma.purchaseAttempt.create({
      data: {
        sessionId,
        orderNumber: session.orderNumber,
        productPrice: session.productPrice,
        shippingCost: session.shippingCost,
        purchaseProofKeys: session.purchaseProofKeys ?? [],
        submittedAt: session.purchasedAt ?? new Date(),
        rejectedAt: new Date(),
        rejectionReason: dto.purchaseRejectionReason,
      },
    });

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        purchaseRejectedAt: new Date(),
        purchaseRejectionReason: dto.purchaseRejectionReason,
        status: SessionStatus.PURCHASE_REJECTED, // Stay at same stage, tester can resubmit
      },
      include: SESSION_INCLUDE,
    });

    return updatedSession as any;
  }

  async completeStep(
    sessionId: string,
    stepId: string,
    testerId: string,
    dto: CompleteStepDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.testerId !== testerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status - Allow step completion after acceptance (for PROCEDURES mode)
    const allowedStatuses: SessionStatus[] = [
      SessionStatus.ACCEPTED,
      SessionStatus.IN_PROGRESS,
      SessionStatus.PROCEDURES_COMPLETED, // Allow re-completing steps if needed
    ];

    if (!allowedStatuses.includes(session.status)) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Guard: vérifier que c'est le jour prévu par la distribution
    this.assertScheduledDateIsToday(session);

    // Find or create step progress
    let stepProgress = await this.prisma.sessionStepProgress.findFirst({
      where: {
        sessionId,
        stepId,
      },
    });

    if (!stepProgress) {
      stepProgress = await this.prisma.sessionStepProgress.create({
        data: {
          sessionId,
          stepId,
          submissionData: dto.submissionData,
          isCompleted: true,
          completedAt: new Date(),
        },
      });
    } else {
      stepProgress = await this.prisma.sessionStepProgress.update({
        where: { id: stepProgress.id },
        data: {
          submissionData: dto.submissionData,
          isCompleted: true,
          completedAt: new Date(),
        },
      });
    }

    // Check if all steps are completed
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: session.campaignId },
      include: {
        procedures: {
          include: {
            steps: true,
          },
        },
      },
    });

    const totalSteps =
      campaign?.procedures.reduce(
        (sum, proc) => sum + proc.steps.length,
        0,
      ) || 0;
    const completedSteps = await this.prisma.sessionStepProgress.count({
      where: {
        sessionId,
        isCompleted: true,
      },
    });

    const allCompleted = completedSteps >= totalSteps;

    // Update session status
    // ACCEPTED → IN_PROGRESS (first step) → PROCEDURES_COMPLETED (all steps)
    let newStatus = session.status;
    if (allCompleted) {
      newStatus = SessionStatus.PROCEDURES_COMPLETED;
    } else if (
      session.status === SessionStatus.ACCEPTED ||
      session.status === SessionStatus.IN_PROGRESS
    ) {
      newStatus = SessionStatus.IN_PROGRESS;
    }

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: newStatus,
      },
      include: SESSION_INCLUDE,
    });

    return updatedSession as any;
  }

  async submitTest(
    sessionId: string,
    testerId: string,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.testerId !== testerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status - can submit test after purchase is validated
    if (session.status !== SessionStatus.PURCHASE_VALIDATED) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Process bonus payment (testerBonus + proBonus → testeur) + commission SuperTry
    // BEFORE flipping the status. Status stays PURCHASE_VALIDATED until the payment
    // succeeds — idempotent via session.bonusPaidAt, so retry is safe.
    try {
      await this.paymentsService.processBonusPayment(sessionId);
    } catch (error) {
      this.logger.error(`Failed to process bonus payment for session ${sessionId}: ${error.message}`);
      throw new I18nHttpException(
        'payment.bonus_payment_failed',
        'PAYMENT_BONUS_FAILED',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Payment succeeded → mark session as submitted.
    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      include: SESSION_INCLUDE,
    });

    return updatedSession as any;
  }

  async complete(
    sessionId: string,
    sellerId: string,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.campaign.seller.id !== sellerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    // Check status
    if (session.status !== SessionStatus.SUBMITTED) {
      throw new I18nHttpException('session.invalid_status', 'SESSION_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Get campaign and offer to calculate reward
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: session.campaignId },
      include: {
        offers: true,
      },
    });

    const offer = campaign?.offers[0];
    if (!offer) {
      throw new I18nHttpException('session.offer_not_found', 'SESSION_OFFER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Calculate total reward amount for historical record on the session
    const rules = await this.businessRulesService.findLatest();
    const testerBonus = rules?.testerBonus ?? 5;
    const rewardAmount =
      Number(session.productPrice) +    // Real product price paid by tester
      Number(session.shippingCost) +   // Real shipping cost paid by tester
      testerBonus +                     // Fixed tester fee (BusinessRules)
      Number(offer.bonus);              // Pro bonus

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.COMPLETED,
        completedAt: new Date(),
        rewardAmount,
      },
      include: SESSION_INCLUDE,
    });

    // Incrémenter le compteur de tests réussis du testeur
    await this.prisma.profile.update({
      where: { id: session.testerId },
      data: { completedSessionsCount: { increment: 1 } },
    });

    // NOTE: Payments are now split into 2 earlier steps:
    // 1. processPurchaseReimbursement (at validatePurchase → PURCHASE_VALIDATED)
    // 2. processBonusPayment + commission (at submitTest → SUBMITTED)
    // No payment processing needed at complete().

    // Audit log
    await this.auditService.log(
      session.testerId,
      AuditCategory.SESSION,
      'TEST_SESSION_COMPLETED',
      {
        sessionId: session.id,
        campaignId: session.campaignId,
        rewardAmount,
      },
    );

    // Gamification: award XP for test completion (non-blocking)
    try {
      const testerProfile = await this.prisma.profile.findUnique({
        where: { id: session.testerId },
        select: { completedSessionsCount: true },
      });

      await this.gamificationService.awardTestCompletionXp(
        session.testerId,
        session.id,
        Number(offer.bonus),
        testerProfile?.completedSessionsCount || 1,
      );
    } catch (error) {
      this.logger.error(`Gamification XP award failed: ${error.message}`);
    }

    this.posthog.capture(session.testerId, 'test_completed', {
      sessionId: session.id,
      campaignId: session.campaignId,
      sellerId: session.campaign.seller.id,
      rewardAmount,
    });

    // Mark the campaign COMPLETED once its last slot has been completed.
    // The session above is already persisted as COMPLETED, so the count includes it.
    try {
      if (campaign.status === CampaignStatus.ACTIVE) {
        const completedCount = await this.prisma.testSession.count({
          where: {
            campaignId: session.campaignId,
            status: SessionStatus.COMPLETED,
          },
        });

        if (completedCount >= campaign.totalSlots) {
          await this.prisma.campaign.update({
            where: { id: session.campaignId },
            data: { status: CampaignStatus.COMPLETED },
          });

          await this.auditService.log(
            session.campaign.seller.id,
            AuditCategory.CAMPAIGN,
            'CAMPAIGN_COMPLETED',
            {
              campaignId: session.campaignId,
              totalSlots: campaign.totalSlots,
              completedSessions: completedCount,
            },
          );

          this.posthog.capture(session.campaign.seller.id, 'campaign_completed', {
            campaignId: session.campaignId,
            totalSlots: campaign.totalSlots,
            completedSessions: completedCount,
          });
        }
      }
    } catch (error) {
      this.logger.error(`Campaign completion check failed: ${error.message}`);
    }

    return updatedSession as any;
  }

  async findMySessions(
    testerId: string,
    filterDto: TestSessionFilterDto,
  ): Promise<PaginatedResponse<TestSessionResponseDto>> {
    const { page = 1, limit = 10, status, campaignId } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = {
      testerId,
    };

    if (status) {
      where.status = status;
    }

    if (campaignId) {
      where.campaignId = campaignId;
    }

    const [sessions, total] = await Promise.all([
      this.prisma.testSession.findMany({
        where,
        skip,
        take: limit,
        include: SESSION_BASIC_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.testSession.count({ where }),
    ]);

    const resolved = await Promise.all(
      sessions.map((s: any) => this.resolveSessionProductImages(s)),
    );
    const stripped = resolved.map((s) => this.stripStepsIfNotScheduledDay(s));
    return createPaginatedResponse(stripped, total, page, limit);
  }

  async findByCampaign(
    campaignId: string,
    sellerId: string,
    filterDto: TestSessionFilterDto,
  ): Promise<PaginatedResponse<TestSessionResponseDto>> {
    // Verify campaign exists and belongs to seller
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, sellerId: true },
    });

    if (!campaign) {
      throw new I18nHttpException('campaign.not_found', 'CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (campaign.sellerId !== sellerId) {
      throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    const { page = 1, limit = 10, status } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { campaignId };

    if (status) {
      where.status = status;
    }

    const [sessions, total] = await Promise.all([
      this.prisma.testSession.findMany({
        where,
        skip,
        take: limit,
        include: SESSION_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.testSession.count({ where }),
    ]);

    const sessionsWithImages = await Promise.all(
      sessions.map((s: any) => this.resolveSessionProductImages(s)),
    );

    return createPaginatedResponse(sessionsWithImages, total, page, limit);
  }

  async findOne(id: string, currentUserId?: string, currentUserRole?: string): Promise<TestSessionResponseDto> {
    const session = await this.prisma.testSession.findUnique({
      where: { id },
      include: SESSION_INCLUDE,
    });

    if (!session) {
      throw new I18nHttpException('session.not_found', 'SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Authorization: only the tester, the campaign owner (PRO seller), or an ADMIN can fetch a session.
    // currentUserId/currentUserRole are optional for backward compatibility with internal callers,
    // but every external (controller-driven) call MUST pass them — see test-sessions.controller.findOne.
    if (currentUserId) {
      const isAdmin = currentUserRole === 'ADMIN';
      const isTester = session.testerId === currentUserId;
      const isSeller = session.campaign?.seller?.id === currentUserId;
      if (!isAdmin && !isTester && !isSeller) {
        throw new I18nHttpException('session.not_owner', 'SESSION_NOT_OWNER', HttpStatus.FORBIDDEN);
      }
    }

    const resolved = await this.resolveSessionProductImages(session as any);
    return this.stripStepsIfNotScheduledDay(resolved);
  }

  /**
   * SEC-E1 : URL signée d'une preuve d'achat, SCOPÉE à la session.
   * findOne() impose l'autorisation (testeur / vendeur de la campagne / admin),
   * et on vérifie que la clé appartient bien aux preuves de CETTE session →
   * remplace l'endpoint média brut (IDOR) pour ce flux.
   */
  async getProofSignedUrl(
    sessionId: string,
    key: string,
    currentUserId: string,
    currentUserRole: string,
  ): Promise<{ url: string }> {
    // Autorise l'accès à la session ou lève 403/404.
    await this.findOne(sessionId, currentUserId, currentUserRole);

    const record = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      select: { purchaseProofKeys: true },
    });
    const raw = record?.purchaseProofKeys;
    const allowedKeys = Array.isArray(raw) ? raw.map((k) => String(k)) : [];

    if (!key || !allowedKeys.includes(key)) {
      throw new I18nHttpException(
        'session.media_not_found',
        'SESSION_MEDIA_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    const url = await this.mediaService.getSignedUrl(key, 3600);
    return { url };
  }

  /**
   * Vérifie que la date du jour correspond à la scheduledPurchaseDate de la session.
   * Si ce n'est pas le bon jour, lève une erreur 400.
   * Bypass possible via BYPASS_BUSINESS_RULES=true uniquement hors production.
   */
  private assertScheduledDateIsToday(session: any): void {
    if (!session.scheduledPurchaseDate) return;
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.BYPASS_BUSINESS_RULES === 'true'
    ) {
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const scheduled = new Date(session.scheduledPurchaseDate);
    const scheduledDay = scheduled.toISOString().split('T')[0];

    if (today !== scheduledDay) {
      const formatted = `${scheduled.getDate().toString().padStart(2, '0')}/${(scheduled.getMonth() + 1).toString().padStart(2, '0')}/${scheduled.getFullYear()}`;
      throw new I18nHttpException(
        'session.not_scheduled_today',
        'SESSION_NOT_SCHEDULED_TODAY',
        HttpStatus.BAD_REQUEST,
        { date: formatted },
      );
    }
  }

  /**
   * Masque les étapes (stepProgress) si la date du jour ne correspond pas à la scheduledPurchaseDate.
   * Pas de bypass BYPASS_BUSINESS_RULES — le testeur ne doit jamais voir les étapes avant le jour J.
   */
  private stripStepsIfNotScheduledDay(session: any): any {
    const isReveal = this.isRevealDay(session.scheduledPurchaseDate);
    if (isReveal) {
      return { ...session, isRevealed: true };
    }
    // Avant le jour J : masquer étapes ET procédure (le testeur ne voit les détails que le jour J)
    return {
      ...session,
      isRevealed: false,
      stepProgress: [],
      campaign: {
        ...session.campaign,
        procedures: [],
      },
    };
  }

  /**
   * Résout les images produit claires pour une session.
   * Le testeur est participant par définition → toujours images claires.
   */
  /**
   * Jour J : la date du jour correspond à scheduledPurchaseDate (ou pas de date programmée).
   * Avant le jour J, le testeur ne voit ni la photo claire, ni la procédure, ni les étapes.
   */
  private isRevealDay(scheduledPurchaseDate?: Date | null): boolean {
    if (!scheduledPurchaseDate) return true;
    const today = new Date().toISOString().split('T')[0];
    return (
      new Date(scheduledPurchaseDate).toISOString().split('T')[0] === today
    );
  }

  private async resolveSessionProductImages(session: any): Promise<any> {
    const offers = session.campaign?.offers || [];
    const isReveal = this.isRevealDay(session.scheduledPurchaseDate);
    const allImages: any[] = [];

    for (const offer of offers) {
      const rawImages: any[] = Array.isArray(offer.product?.images)
        ? offer.product.images
        : [];
      for (const img of rawImages) {
        const normalized = normalizeImageEntry(img);
        // Avant le jour J : image floutée. Le jour J : image claire.
        const key = isReveal ? normalized.clearKey : normalized.blurredKey;
        if (key.startsWith('http://') || key.startsWith('https://')) {
          const extracted = this.mediaService.extractKeyFromUrl(key);
          if (extracted) allImages.push(extracted);
        } else {
          allImages.push(key);
        }
      }
    }

    const signedUrls =
      allImages.length > 0
        ? await this.mediaService.getSignedUrls(allImages)
        : [];

    // Nettoyer chaque offer : plafond de dépense, masquage du prix exact, suppression du produit brut
    const cleanOffers = offers.map((o: any) => {
      const spendCeiling = computeSpendCeiling(o.product?.price, o.shippingCost);
      const { product, ...rest } = o;
      // Le prix exact n'est jamais exposé au testeur (sauf si le PRO l'a explicitement révélé)
      if (!o.isPriceRevealed) {
        delete rest.expectedPrice;
        delete rest.priceRangeMin;
        delete rest.priceRangeMax;
        delete rest.maxReimbursedPrice;
        delete rest.maxReimbursedShipping;
      }
      return { ...rest, spendCeiling };
    });

    return {
      ...session,
      campaign: {
        ...session.campaign,
        offers: cleanOffers,
      },
      productImages: signedUrls,
    };
  }

  async getActionCounts(currentUserId: string): Promise<Record<string, Record<string, number>>> {
    const statuses: SessionStatus[] = [
      SessionStatus.PENDING,
      SessionStatus.PURCHASE_SUBMITTED,
      SessionStatus.SUBMITTED,
    ];

    const groups = await this.prisma.testSession.groupBy({
      by: ['campaignId', 'status'],
      where: {
        status: { in: statuses },
        campaign: { sellerId: currentUserId },
      },
      _count: true,
    });

    const result: Record<string, Record<string, number>> = {};

    for (const group of groups) {
      if (!result[group.campaignId]) {
        result[group.campaignId] = {
          PENDING: 0,
          PURCHASE_SUBMITTED: 0,
          SUBMITTED: 0,
        };
      }
      result[group.campaignId][group.status] = group._count;
    }

    return result;
  }
}
