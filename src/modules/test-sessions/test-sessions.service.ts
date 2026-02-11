import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
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
import { RejectSessionDto } from './dto/reject-session.dto';
import { RejectPurchaseDto } from './dto/reject-purchase.dto';
import { TestSessionResponseDto } from './dto/test-session-response.dto';
import { TestSessionFilterDto } from './dto/test-session-filter.dto';
import {
  PaginatedResponse,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { SessionStatus, CampaignMarketplaceMode, AuditCategory } from '@prisma/client';

@Injectable()
export class TestSessionsService {
  private readonly logger = new Logger(TestSessionsService.name);

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private stripeService: StripeService,
    private auditService: AuditService,
    private businessRulesService: BusinessRulesService,
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
        distributions: {
          where: { isActive: true },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign with ID '${campaignId}' not found`);
    }

    if (campaign.status !== 'ACTIVE') {
      throw new BadRequestException('Campaign is not active');
    }

    // Check available slots
    if (campaign.availableSlots <= 0) {
      throw new BadRequestException('No available slots for this campaign');
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
      },
    });

    if (tester?.bannedUntil && tester.bannedUntil > new Date()) {
      throw new BadRequestException(
        `You are temporarily banned until ${tester.bannedUntil.toISOString()}`,
      );
    }

    // Vérification onboarding + KYC conditionnel
    const skipKYC = process.env.SKIP_KYC_VERIFICATION === 'true';

    if (!skipKYC) {
      // 1. Stripe Connect créé ?
      if (!tester?.stripeConnectAccountId) {
        throw new BadRequestException({
          message: 'Create Stripe Connect account first',
          identityRequired: true,
        });
      }

      // 2. Onboarding Connect complété (IBAN, infos perso) ?
      if (!tester.stripeOnboardingCompleted) {
        throw new BadRequestException({
          message: 'Complete Stripe Connect onboarding first (bank account setup)',
          onboardingRequired: true,
        });
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

        throw new BadRequestException({
          message: `Identity verification required after ${kycThreshold} completed tests. Please verify your identity to continue applying.`,
          identityRequired: true,
          verificationUrl: verificationSession.url,
          clientSecret: verificationSession.clientSecret,
        });
      }
    } else {
      console.warn('⚠️  KYC verification skipped (SKIP_KYC_VERIFICATION=true)');
    }

    // Calculate scheduled purchase date
    const scheduledPurchaseDate = await this.calculateScheduledPurchaseDate(
      campaign.distributions,
    );

    // Create test session
    const session = await this.prisma.$transaction(async (tx) => {
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
          scheduledPurchaseDate,
          acceptedAt: campaign.autoAcceptApplications ? new Date() : null,
        },
        include: {
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
        },
      });

      return createdSession;
    });

    return session as any;
  }

  private async calculateScheduledPurchaseDate(
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
      throw new BadRequestException('No available distribution slots');
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
      throw new ForbiddenException(
        'You can only accept sessions for your own campaigns',
      );
    }

    // Check status
    if (session.status !== SessionStatus.PENDING) {
      throw new BadRequestException('Only PENDING sessions can be accepted');
    }

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
      include: {
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
      },
    });

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
      throw new ForbiddenException(
        'You can only reject sessions for your own campaigns',
      );
    }

    // Check status
    if (session.status !== SessionStatus.PENDING) {
      throw new BadRequestException('Only PENDING sessions can be rejected');
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
        include: {
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
        },
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
      throw new ForbiddenException('You can only cancel your own sessions');
    }

    // Check status - can cancel PENDING, ACCEPTED, PRICE_VALIDATED, or PURCHASE_VALIDATED
    const cancellableStatuses: SessionStatus[] = [
      SessionStatus.PENDING,
      SessionStatus.ACCEPTED,
      SessionStatus.PRICE_VALIDATED,
      SessionStatus.PURCHASE_VALIDATED,
    ];

    if (!cancellableStatuses.includes(session.status)) {
      throw new BadRequestException(
        `Cannot cancel session in ${session.status} status`,
      );
    }

    // Get business rules
    const businessRules = await this.prisma.businessRules.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const gracePeriodMinutes =
      businessRules?.campaignActivationGracePeriodMinutes || 60;
    const banDays = businessRules?.testerCancellationBanDays || 14;

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

      // Appliquer ban si hors grace period (ban uniforme de 14 jours)
      if (!withinGracePeriod) {
        const bannedUntil = new Date();
        bannedUntil.setDate(bannedUntil.getDate() + banDays);

        await tx.profile.update({
          where: { id: testerId },
          data: {
            cancellationCount: { increment: 1 },
            lastCancellationAt: now,
            bannedUntil,
          },
        });

        this.logger.log(
          `Tester ${testerId} banned until ${bannedUntil.toISOString()} (${banDays} days)`,
        );
      }

      // Update session
      return await tx.testSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.CANCELLED,
          cancelledAt: now,
          cancellationReason: dto.cancellationReason,
        },
        include: {
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
        },
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

  async validatePrice(
    sessionId: string,
    testerId: string,
    dto: ValidatePriceDto,
  ): Promise<TestSessionResponseDto> {
    const session = await this.findOne(sessionId);

    // Check ownership
    if (session.testerId !== testerId) {
      throw new ForbiddenException(
        'You can only validate price for your own sessions',
      );
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
      throw new BadRequestException(
        'Price validation not required for PRODUCT_LINK mode',
      );
    }

    // Check status - must have completed all procedures first (for PROCEDURES mode)
    if (session.status !== SessionStatus.PROCEDURES_COMPLETED) {
      throw new BadRequestException(
        'Can only validate price after all procedures are completed',
      );
    }

    const offer = campaign?.offers[0];
    if (!offer) {
      throw new BadRequestException('Offer not found for this campaign');
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
        include: {
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
        },
      });

      return updatedSession as any;
    } else {
      // Price is incorrect
      const attempts = session.priceValidationAttempts + 1;

      if (attempts >= 2) {
        // After 2 failed attempts, ask for product title
        throw new BadRequestException(
          'Price validation failed. Please submit the product title.',
        );
      }

      await this.prisma.testSession.update({
        where: { id: sessionId },
        data: {
          priceValidationAttempts: attempts,
        },
      });

      throw new BadRequestException(
        `Incorrect price. Expected between ${offer.priceRangeMin}€ and ${offer.priceRangeMax}€. Attempt ${attempts}/2`,
      );
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
      throw new ForbiddenException(
        'You can only submit purchase for your own sessions',
      );
    }

    // Check status - depends on marketplace mode
    const campaign = session.campaign;

    if (campaign.marketplaceMode === CampaignMarketplaceMode.PRODUCT_LINK) {
      // PRODUCT_LINK: can submit purchase directly after acceptance (no price validation needed)
      if (session.status !== SessionStatus.ACCEPTED) {
        throw new BadRequestException(
          'Can only submit purchase after acceptance for PRODUCT_LINK mode',
        );
      }
    } else {
      // PROCEDURES: must complete procedures and validate price first
      if (session.status !== SessionStatus.PRICE_VALIDATED) {
        throw new BadRequestException(
          'Can only submit purchase after price validation for PROCEDURES mode',
        );
      }
    }

    // Check scheduled purchase date (allow ±1 day tolerance)
    const bypassBusinessRules = process.env.BYPASS_BUSINESS_RULES === 'true';

    if (session.scheduledPurchaseDate && !bypassBusinessRules) {
      const today = new Date();
      const scheduled = new Date(session.scheduledPurchaseDate);
      const diffDays = Math.abs(
        (today.getTime() - scheduled.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays > 1) {
        throw new BadRequestException(
          `Purchase can only be submitted around ${scheduled.toISOString().split('T')[0]}`,
        );
      }
    }

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.PURCHASE_SUBMITTED,
        orderNumber: dto.orderNumber,
        productPrice: dto.productPrice,
        shippingCost: dto.shippingCost,
        purchaseProofUrl: dto.purchaseProofUrl,
        purchasedAt: new Date(),
      },
      include: {
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
      },
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
      throw new ForbiddenException(
        'You can only validate purchases for your own campaigns',
      );
    }

    // Check status
    if (session.status !== SessionStatus.PURCHASE_SUBMITTED) {
      throw new BadRequestException(
        'Can only validate PURCHASE_SUBMITTED sessions',
      );
    }

    // Prepare update data
    const updateData: any = {
      status: SessionStatus.PURCHASE_VALIDATED,
      purchaseValidatedAt: new Date(),
    };

    // Allow PRO to override productPrice if provided
    if (dto?.productPrice !== undefined) {
      updateData.productPrice = dto.productPrice;
    }

    // Allow PRO to override shippingCost if provided
    if (dto?.shippingCost !== undefined) {
      updateData.shippingCost = dto.shippingCost;
    }

    // Add validation comment if provided
    if (dto?.purchaseValidationComment) {
      updateData.purchaseValidationComment = dto.purchaseValidationComment;
    }

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: updateData,
      include: {
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
      },
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
      throw new ForbiddenException(
        'You can only reject purchases for your own campaigns',
      );
    }

    // Check status
    if (session.status !== SessionStatus.PURCHASE_SUBMITTED) {
      throw new BadRequestException(
        'Can only reject PURCHASE_SUBMITTED sessions',
      );
    }

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        purchaseRejectedAt: new Date(),
        purchaseRejectionReason: dto.purchaseRejectionReason,
        status: SessionStatus.ACCEPTED, // Go back to ACCEPTED so tester can resubmit
      },
      include: {
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
      },
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
      throw new ForbiddenException(
        'You can only complete steps for your own sessions',
      );
    }

    // Check status - Allow step completion after acceptance (for PROCEDURES mode)
    const allowedStatuses: SessionStatus[] = [
      SessionStatus.ACCEPTED,
      SessionStatus.IN_PROGRESS,
      SessionStatus.PROCEDURES_COMPLETED, // Allow re-completing steps if needed
    ];

    if (!allowedStatuses.includes(session.status)) {
      throw new BadRequestException(
        'Can only complete steps after application is accepted',
      );
    }

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
      include: {
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
      },
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
      throw new ForbiddenException(
        'You can only submit test for your own sessions',
      );
    }

    // Check status - can submit test after purchase is validated
    if (session.status !== SessionStatus.PURCHASE_VALIDATED) {
      throw new BadRequestException(
        'Can only submit test after purchase is validated by PRO',
      );
    }

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      include: {
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
      },
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
      throw new ForbiddenException(
        'You can only complete sessions for your own campaigns',
      );
    }

    // Check status
    if (session.status !== SessionStatus.SUBMITTED) {
      throw new BadRequestException('Can only complete SUBMITTED sessions');
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
      throw new BadRequestException('Offer not found');
    }

    // Calculate reward amount: REAL productPrice + REAL shippingCost + bonus
    // Use the actual amounts paid by the tester, not the expected/max amounts
    const rewardAmount =
      Number(session.productPrice) +    // Real product price paid by tester
      Number(session.shippingCost) +   // Real shipping cost paid by tester
      Number(offer.bonus);              // Bonus is always fixed

    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.COMPLETED,
        completedAt: new Date(),
        rewardAmount,
      },
      include: {
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
      },
    });

    // Incrémenter le compteur de tests réussis du testeur
    await this.prisma.profile.update({
      where: { id: session.testerId },
      data: { completedSessionsCount: { increment: 1 } },
    });

    // Process payment to tester
    try {
      const { testerTransfer, testerTransaction, commissionTransaction } =
        await this.paymentsService.processTestCompletion(session.id);

      this.logger.log(`Tester paid: ${testerTransaction.amount.toNumber()}€`);
      this.logger.log(`Commission: ${commissionTransaction.amount.toNumber()}€`);

      // Audit log
      await this.auditService.log(
        session.testerId,
        AuditCategory.SESSION,
        'TEST_SESSION_COMPLETED',
        {
          sessionId: session.id,
          campaignId: session.campaignId,
          testerPayment: testerTransaction.amount.toNumber(),
          commission: commissionTransaction.amount.toNumber(),
        },
      );
    } catch (error) {
      this.logger.error(`Failed to process test completion payment: ${error.message}`);
      // Don't throw - session is still marked as COMPLETED
      // Payment can be retried later
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
        include: {
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
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.testSession.count({ where }),
    ]);

    return createPaginatedResponse(sessions as any, total, page, limit);
  }

  async findOne(id: string): Promise<TestSessionResponseDto> {
    const session = await this.prisma.testSession.findUnique({
      where: { id },
      include: {
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
      },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID '${id}' not found`);
    }

    return session as any;
  }
}
