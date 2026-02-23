import { Injectable, Logger } from '@nestjs/common';
import {
  TesterTier,
  XpEventType,
  AuditCategory,
  SessionStatus,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import {
  getTierForXp,
  getNextTier,
  isTierAtLeast,
  TIER_THRESHOLDS,
  TIER_NAMES,
  TIER_ORDER,
  MILESTONES,
} from './gamification.constants';
import { XpDashboardResponseDto } from './dto/xp-dashboard-response.dto';
import { XpHistoryFilterDto } from './dto/xp-history-filter.dto';
import {
  PaginatedResponse,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';
import { XpEventResponseDto } from './dto/xp-event-response.dto';

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ============================================================================
  // PUBLIC: Award XP on test completion
  // ============================================================================

  async awardTestCompletionXp(
    testerId: string,
    sessionId: string,
    offerBonus: number,
    completedSessionsCount: number,
  ): Promise<void> {
    const rules = await this.businessRulesService.findLatest();

    // 1. Base XP
    await this.grantXp(testerId, XpEventType.TEST_COMPLETED, rules.xpTestCompleted, {
      sessionId,
      description: 'Test complété',
    });

    // 2. First test bonus (one-time)
    if (completedSessionsCount === 1) {
      await this.grantXp(testerId, XpEventType.FIRST_TEST_BONUS, rules.xpFirstTestBonus, {
        sessionId,
        description: 'Premier test complété !',
      });
    }

    // 3. Low bonus altruism
    if (offerBonus <= 5) {
      await this.grantXp(testerId, XpEventType.LOW_BONUS_ALTRUISM, rules.xpLowBonusAltruism, {
        sessionId,
        description: 'Bonus altruisme (campagne à bonus minimum)',
      });
    } else if (offerBonus <= 7) {
      const halfAltruism = Math.round(rules.xpLowBonusAltruism / 2);
      await this.grantXp(testerId, XpEventType.LOW_BONUS_ALTRUISM, halfAltruism, {
        sessionId,
        description: 'Bonus altruisme (campagne à petit bonus)',
      });
    }

    // 4. Streak bonus (3+ tests in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentCompletedCount = await this.prisma.testSession.count({
      where: {
        testerId,
        status: SessionStatus.COMPLETED,
        completedAt: { gte: thirtyDaysAgo },
      },
    });

    if (recentCompletedCount >= 3) {
      await this.grantXp(testerId, XpEventType.STREAK_BONUS, rules.xpStreakBonus, {
        sessionId,
        description: `Streak bonus (${recentCompletedCount} tests en 30 jours)`,
      });
    }

    // 5. Milestone bonuses
    for (const [milestone, bonusXp] of Object.entries(MILESTONES)) {
      if (completedSessionsCount === Number(milestone)) {
        await this.grantXp(testerId, XpEventType.MILESTONE_BONUS, bonusXp, {
          sessionId,
          description: `Milestone atteint : ${milestone} tests complétés !`,
        });
        break;
      }
    }
  }

  // ============================================================================
  // PUBLIC: Award XP on tester rating
  // ============================================================================

  async awardRatingXp(
    testerId: string,
    sessionId: string,
    ratingId: string,
    ratingValue: number,
  ): Promise<void> {
    const rules = await this.businessRulesService.findLatest();

    if (ratingValue >= 4) {
      await this.grantXp(testerId, XpEventType.HIGH_RATING_BONUS, rules.xpHighRatingBonus, {
        sessionId,
        ratingId,
        description: `Bonne note reçue (${ratingValue}/5)`,
      });
    }

    if (ratingValue === 5) {
      await this.grantXp(testerId, XpEventType.PERFECT_RATING_BONUS, rules.xpPerfectRatingBonus, {
        sessionId,
        ratingId,
        description: 'Note parfaite reçue (5/5) !',
      });
    }
  }

  // ============================================================================
  // PUBLIC: Reverse XP on dispute resolution
  // ============================================================================

  async reverseSessionXp(testerId: string, sessionId: string): Promise<void> {
    // Find all XP events for this session
    const sessionXpEvents = await this.prisma.xpEvent.findMany({
      where: {
        profileId: testerId,
        sessionId,
        type: XpEventType.TEST_COMPLETED,
      },
    });

    const totalToReverse = sessionXpEvents.reduce((sum, e) => sum + e.amount, 0);

    if (totalToReverse > 0) {
      await this.grantXp(testerId, XpEventType.DISPUTE_REVERSAL, -totalToReverse, {
        sessionId,
        description: `Reversal XP suite à dispute (session ${sessionId})`,
      });
    }
  }

  // ============================================================================
  // PUBLIC: Admin manual adjustment
  // ============================================================================

  async adminAdjustXp(
    adminId: string,
    testerId: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    await this.grantXp(testerId, XpEventType.ADMIN_ADJUSTMENT, amount, {
      description: `Ajustement admin : ${reason}`,
      metadata: { adminId, reason },
    });

    await this.auditService.log(adminId, AuditCategory.ADMIN, 'XP_ADJUSTMENT', {
      testerId,
      amount,
      reason,
    });
  }

  // ============================================================================
  // PUBLIC: Check tier eligibility for a product price
  // ============================================================================

  async checkTierEligibility(
    testerId: string,
    expectedProductPrice: number,
  ): Promise<{
    eligible: boolean;
    reason?: string;
    testerTier: TesterTier;
    maxAllowedPrice: number;
  }> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: testerId },
      select: { tier: true },
    });

    const tier = profile?.tier || TesterTier.BRONZE;
    const maxPrice = await this.getMaxProductPriceForTier(tier);

    if (expectedProductPrice > maxPrice) {
      return {
        eligible: false,
        reason: `Votre palier ${TIER_NAMES[tier]} permet l'accès aux produits jusqu'à ${maxPrice}€. Ce produit coûte ${expectedProductPrice}€.`,
        testerTier: tier,
        maxAllowedPrice: maxPrice,
      };
    }

    return {
      eligible: true,
      testerTier: tier,
      maxAllowedPrice: maxPrice,
    };
  }

  // ============================================================================
  // PUBLIC: Get max product price for a given tier
  // ============================================================================

  async getMaxProductPriceForTier(tier: TesterTier): Promise<number> {
    const rules = await this.businessRulesService.findLatest();

    const priceMap: Record<TesterTier, number> = {
      BRONZE: Number(rules.tierBronzeMaxProductPrice),
      SILVER: Number(rules.tierSilverMaxProductPrice),
      GOLD: Number(rules.tierGoldMaxProductPrice),
      PLATINUM: Number(rules.tierPlatinumMaxProductPrice),
      DIAMOND: Number(rules.tierDiamondMaxProductPrice),
    };

    return priceMap[tier] ?? 99999;
  }

  // ============================================================================
  // PUBLIC: Dashboard
  // ============================================================================

  async getDashboard(testerId: string): Promise<XpDashboardResponseDto> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: testerId },
      select: {
        totalXp: true,
        tier: true,
        completedSessionsCount: true,
      },
    });

    if (!profile) {
      return {
        totalXp: 0,
        tier: TesterTier.BRONZE,
        tierName: TIER_NAMES[TesterTier.BRONZE],
        nextTier: TesterTier.SILVER,
        nextTierName: TIER_NAMES[TesterTier.SILVER],
        xpToNextTier: TIER_THRESHOLDS[TesterTier.SILVER],
        progressPercent: 0,
        maxProductPrice: 30,
        completedTests: 0,
        recentXpEvents: [],
      };
    }

    const currentTier = profile.tier;
    const nextTier = getNextTier(currentTier);
    const maxPrice = await this.getMaxProductPriceForTier(currentTier);

    // Calculate progress within current tier band
    let progressPercent = 100;
    let xpToNextTier: number | null = null;

    if (nextTier) {
      const currentThreshold = TIER_THRESHOLDS[currentTier];
      const nextThreshold = TIER_THRESHOLDS[nextTier];
      const bandSize = nextThreshold - currentThreshold;
      const progressInBand = profile.totalXp - currentThreshold;
      progressPercent = Math.min(100, Math.round((progressInBand / bandSize) * 100));
      xpToNextTier = nextThreshold - profile.totalXp;
    }

    // Recent XP events
    const recentEvents = await this.prisma.xpEvent.findMany({
      where: { profileId: testerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      totalXp: profile.totalXp,
      tier: currentTier,
      tierName: TIER_NAMES[currentTier],
      nextTier,
      nextTierName: nextTier ? TIER_NAMES[nextTier] : null,
      xpToNextTier,
      progressPercent,
      maxProductPrice: maxPrice,
      completedTests: profile.completedSessionsCount,
      recentXpEvents: recentEvents.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        description: e.description,
        sessionId: e.sessionId,
        createdAt: e.createdAt,
      })),
    };
  }

  // ============================================================================
  // PUBLIC: XP History (paginated)
  // ============================================================================

  async getXpHistory(
    testerId: string,
    filterDto: XpHistoryFilterDto,
  ): Promise<PaginatedResponse<XpEventResponseDto>> {
    const { page = 1, limit = 10, type } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { profileId: testerId };
    if (type) {
      where.type = type;
    }

    const [events, total] = await Promise.all([
      this.prisma.xpEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.xpEvent.count({ where }),
    ]);

    const data = events.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      description: e.description,
      sessionId: e.sessionId,
      createdAt: e.createdAt,
    }));

    return createPaginatedResponse(data, total, page, limit);
  }

  // ============================================================================
  // PUBLIC: Backfill existing testers
  // ============================================================================

  async backfillExistingTesters(): Promise<{ processed: number; errors: number }> {
    const testers = await this.prisma.profile.findMany({
      where: { role: 'USER' },
      select: {
        id: true,
        completedSessionsCount: true,
        testerRatingsReceived: {
          select: { rating: true },
        },
      },
    });

    let processed = 0;
    let errors = 0;

    for (const tester of testers) {
      try {
        let totalXp = 0;

        // Base XP for completed tests
        totalXp += tester.completedSessionsCount * 100;

        // First test bonus
        if (tester.completedSessionsCount > 0) {
          totalXp += 100;
        }

        // Rating bonuses
        for (const rating of tester.testerRatingsReceived) {
          const ratingValue = Number(rating.rating);
          if (ratingValue >= 4) totalXp += 50;
          if (ratingValue === 5) totalXp += 30;
        }

        // Milestone bonuses
        for (const [milestone, bonus] of Object.entries(MILESTONES)) {
          if (tester.completedSessionsCount >= Number(milestone)) {
            totalXp += bonus;
          }
        }

        const tier = getTierForXp(totalXp);

        await this.prisma.$transaction([
          this.prisma.profile.update({
            where: { id: tester.id },
            data: { totalXp, tier },
          }),
          this.prisma.xpEvent.create({
            data: {
              profileId: tester.id,
              type: XpEventType.ADMIN_ADJUSTMENT,
              amount: totalXp,
              description: `Backfill: XP rétroactif (${tester.completedSessionsCount} tests, ${tester.testerRatingsReceived.length} notes)`,
            },
          }),
        ]);

        processed++;
      } catch (error) {
        this.logger.error(`Backfill failed for tester ${tester.id}: ${error.message}`);
        errors++;
      }
    }

    this.logger.log(`Backfill complete: ${processed} processed, ${errors} errors`);
    return { processed, errors };
  }

  // ============================================================================
  // PUBLIC: Get all tiers info (for public endpoint)
  // ============================================================================

  async getTiersInfo(): Promise<
    Array<{
      tier: TesterTier;
      name: string;
      xpRequired: number;
      maxProductPrice: number;
    }>
  > {
    const rules = await this.businessRulesService.findLatest();

    const priceMap: Record<TesterTier, number> = {
      BRONZE: Number(rules.tierBronzeMaxProductPrice),
      SILVER: Number(rules.tierSilverMaxProductPrice),
      GOLD: Number(rules.tierGoldMaxProductPrice),
      PLATINUM: Number(rules.tierPlatinumMaxProductPrice),
      DIAMOND: Number(rules.tierDiamondMaxProductPrice),
    };

    return TIER_ORDER.map((tier) => ({
      tier,
      name: TIER_NAMES[tier],
      xpRequired: TIER_THRESHOLDS[tier],
      maxProductPrice: priceMap[tier],
    }));
  }

  // ============================================================================
  // PRIVATE: Core XP granting + tier recomputation
  // ============================================================================

  private async grantXp(
    profileId: string,
    type: XpEventType,
    amount: number,
    context: {
      sessionId?: string;
      ratingId?: string;
      description?: string;
      metadata?: any;
    },
  ): Promise<void> {
    if (amount === 0) return;

    // Create XP event + atomic increment in transaction
    await this.prisma.$transaction([
      this.prisma.xpEvent.create({
        data: {
          profileId,
          type,
          amount,
          sessionId: context.sessionId || null,
          ratingId: context.ratingId || null,
          description: context.description || null,
          metadata: context.metadata || null,
        },
      }),
      this.prisma.profile.update({
        where: { id: profileId },
        data: {
          totalXp: { increment: amount },
        },
      }),
    ]);

    // Recompute tier after XP change
    await this.recomputeTier(profileId);
  }

  private async recomputeTier(profileId: string): Promise<void> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { totalXp: true, tier: true, email: true, firstName: true },
    });

    if (!profile) return;

    // Floor at 0
    const effectiveXp = Math.max(0, profile.totalXp);
    const newTier = getTierForXp(effectiveXp);

    if (newTier !== profile.tier) {
      const isPromotion = TIER_ORDER.indexOf(newTier) > TIER_ORDER.indexOf(profile.tier);

      await this.prisma.profile.update({
        where: { id: profileId },
        data: {
          tier: newTier,
          totalXp: effectiveXp,
          tierUpdatedAt: new Date(),
        },
      });

      this.logger.log(
        `Tier ${isPromotion ? 'promotion' : 'demotion'}: ${profileId} ${profile.tier} → ${newTier}`,
      );

      // Send notification on tier promotion
      if (isPromotion && profile.email) {
        try {
          await this.notificationsService.queueEmail({
            to: profile.email,
            template: NotificationTemplate.GENERIC_NOTIFICATION,
            subject: `Félicitations ! Vous êtes maintenant ${TIER_NAMES[newTier]} !`,
            variables: {
              firstName: profile.firstName || 'Testeur',
              message: `Bravo ! Vous avez atteint le palier ${TIER_NAMES[newTier]} avec ${effectiveXp} XP. Vous pouvez maintenant accéder à de nouvelles campagnes !`,
            },
            metadata: {
              userId: profileId,
              type: NotificationType.SYSTEM_ALERT,
            },
          });
        } catch (error) {
          this.logger.error(`Failed to send tier promotion notification: ${error.message}`);
        }
      }
    } else if (effectiveXp !== profile.totalXp) {
      // Just fix the totalXp floor if needed
      await this.prisma.profile.update({
        where: { id: profileId },
        data: { totalXp: effectiveXp },
      });
    }
  }
}
