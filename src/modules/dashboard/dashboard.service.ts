import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { GamificationService } from '../gamification/gamification.service';
import { StripeService } from '../stripe/stripe.service';
import { MessagesService } from '../messages/messages.service';
import {
  Profile,
  UserRole,
  CampaignStatus,
  SessionStatus,
  TransactionType,
  TransactionStatus,
  WithdrawalStatus,
} from '@prisma/client';
import { ACTIVE_SESSION_STATUSES } from './dashboard.constants';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly gamificationService: GamificationService,
    private readonly stripeService: StripeService,
    private readonly messagesService: MessagesService,
  ) {}

  async getDashboard(user: Profile) {
    switch (user.role) {
      case UserRole.USER:
        return this.getTesterDashboard(user);
      case UserRole.PRO:
        return this.getSellerDashboard(user);
      case UserRole.ADMIN:
        return this.getAdminDashboard();
      default:
        return this.getTesterDashboard(user);
    }
  }

  // ==========================================================================
  // Tester Dashboard (USER)
  // ==========================================================================

  private async getTesterDashboard(user: Profile) {
    const userId = user.id;

    const [
      sessionCounts,
      wallet,
      kycStatus,
      gamification,
      recentSessions,
      availableCampaignsCount,
    ] = await Promise.all([
      this.getSessionCountsForTester(userId),
      this.getWalletSafe(userId),
      this.getKycStatusSafe(user.stripeConnectAccountId),
      this.gamificationService.getDashboard(userId),
      this.prisma.testSession.findMany({
        where: { testerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          rewardAmount: true,
          createdAt: true,
          campaign: {
            select: {
              id: true,
              title: true,
              seller: {
                select: {
                  firstName: true,
                  lastName: true,
                  companyName: true,
                },
              },
            },
          },
        },
      }),
      this.getAvailableCampaignsCount(userId),
    ]);

    return {
      role: 'USER',
      stats: {
        completedSessions: sessionCounts.completed,
        pendingSessions: sessionCounts.pending,
        activeSessions: sessionCounts.active,
        totalEarned: wallet.totalEarned,
        currentBalance: wallet.balance,
        pendingBalance: wallet.pendingBalance,
        averageRating: user.averageRating ? Number(user.averageRating) : null,
      },
      kyc: kycStatus,
      gamification,
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        status: s.status,
        rewardAmount: s.rewardAmount ? Number(s.rewardAmount) : null,
        createdAt: s.createdAt,
        campaign: s.campaign,
      })),
      availableCampaignsCount,
    };
  }

  private async getSessionCountsForTester(testerId: string) {
    const [completed, pending, active] = await Promise.all([
      this.prisma.testSession.count({
        where: { testerId, status: SessionStatus.COMPLETED },
      }),
      this.prisma.testSession.count({
        where: { testerId, status: SessionStatus.PENDING },
      }),
      this.prisma.testSession.count({
        where: { testerId, status: { in: ACTIVE_SESSION_STATUSES } },
      }),
    ]);
    return { completed, pending, active };
  }

  private async getWalletSafe(userId: string) {
    try {
      const wallet = await this.walletService.getWallet(userId);
      return {
        balance: Number(wallet.balance),
        pendingBalance: Number(wallet.pendingBalance),
        totalEarned: Number(wallet.totalEarned),
      };
    } catch {
      return { balance: 0, pendingBalance: 0, totalEarned: 0 };
    }
  }

  private async getKycStatusSafe(stripeConnectAccountId: string | null) {
    if (!stripeConnectAccountId) {
      return {
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        kycRequired: true,
      };
    }
    try {
      const status =
        await this.stripeService.getKycStatus(stripeConnectAccountId);
      return {
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        detailsSubmitted: status.detailsSubmitted,
        kycRequired: !status.detailsSubmitted,
      };
    } catch {
      this.logger.warn(
        `KYC status fetch failed for account ${stripeConnectAccountId}`,
      );
      return {
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        kycRequired: true,
      };
    }
  }

  private async getAvailableCampaignsCount(testerId: string): Promise<number> {
    const appliedSessions = await this.prisma.testSession.findMany({
      where: { testerId },
      select: { campaignId: true },
    });
    const excludedIds = appliedSessions.map((s) => s.campaignId);

    return this.prisma.campaign.count({
      where: {
        status: CampaignStatus.ACTIVE,
        availableSlots: { gt: 0 },
        ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
      },
    });
  }

  // ==========================================================================
  // Seller Dashboard (PRO)
  // ==========================================================================

  private async getSellerDashboard(user: Profile) {
    const sellerId = user.id;

    const [
      campaignCounts,
      sessionCounts,
      financialStats,
      unreadMessages,
      recentCampaigns,
      recentSessions,
      monthlyActivity,
    ] = await Promise.all([
      this.getCampaignCountsForSeller(sellerId),
      this.getSessionCountsForSeller(sellerId),
      this.getFinancialStatsForSeller(sellerId),
      this.messagesService.getUnreadCounts(sellerId),
      this.prisma.campaign.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          totalSlots: true,
          availableSlots: true,
          createdAt: true,
          category: { select: { id: true, name: true } },
          _count: {
            select: {
              testSessions: { where: { status: SessionStatus.COMPLETED } },
            },
          },
        },
      }),
      this.prisma.testSession.findMany({
        where: { campaign: { sellerId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          createdAt: true,
          tester: {
            select: {
              firstName: true,
              lastName: true,
              avatar: true,
              averageRating: true,
              completedSessionsCount: true,
            },
          },
          campaign: {
            select: { id: true, title: true },
          },
        },
      }),
      this.getMonthlyActivityForSeller(sellerId),
    ]);

    const totalUnread = unreadMessages.reduce((sum, u) => sum + u.count, 0);

    return {
      role: 'PRO',
      stats: {
        totalCampaigns: campaignCounts.total,
        activeCampaigns: campaignCounts.active,
        draftCampaigns: campaignCounts.draft,
        completedCampaigns: campaignCounts.completed,
        totalTestSessions: sessionCounts.total,
        pendingApplications: sessionCounts.pending,
        activeTestSessions: sessionCounts.active,
        completedTestSessions: sessionCounts.completed,
        totalSpent: financialStats.totalSpent,
        escrowBalance: financialStats.escrowBalance,
        averageCompletionRate:
          sessionCounts.total > 0
            ? Math.round(
                (sessionCounts.completed / sessionCounts.total) * 1000,
              ) / 10
            : 0,
        unreadMessages: totalUnread,
      },
      recentCampaigns: recentCampaigns.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        totalSlots: c.totalSlots,
        availableSlots: c.availableSlots,
        filledSlots: c.totalSlots - c.availableSlots,
        completedSlots: c._count.testSessions,
        createdAt: c.createdAt,
        category: c.category,
      })),
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        status: s.status,
        createdAt: s.createdAt,
        tester: {
          firstName: s.tester.firstName,
          lastName: s.tester.lastName
            ? s.tester.lastName.charAt(0) + '.'
            : null,
          avatar: s.tester.avatar,
          averageRating: s.tester.averageRating
            ? Number(s.tester.averageRating)
            : null,
          completedSessionsCount: s.tester.completedSessionsCount,
        },
        campaign: s.campaign,
      })),
      monthlyActivity,
    };
  }

  private async getCampaignCountsForSeller(sellerId: string) {
    const [total, active, draft, completed] = await Promise.all([
      this.prisma.campaign.count({ where: { sellerId } }),
      this.prisma.campaign.count({
        where: { sellerId, status: CampaignStatus.ACTIVE },
      }),
      this.prisma.campaign.count({
        where: {
          sellerId,
          status: { in: [CampaignStatus.DRAFT, CampaignStatus.PENDING_PAYMENT] },
        },
      }),
      this.prisma.campaign.count({
        where: { sellerId, status: CampaignStatus.COMPLETED },
      }),
    ]);
    return { total, active, draft, completed };
  }

  private async getSessionCountsForSeller(sellerId: string) {
    const campaignFilter = { campaign: { sellerId } };
    const [total, pending, active, completed] = await Promise.all([
      this.prisma.testSession.count({ where: campaignFilter }),
      this.prisma.testSession.count({
        where: { ...campaignFilter, status: SessionStatus.PENDING },
      }),
      this.prisma.testSession.count({
        where: { ...campaignFilter, status: { in: ACTIVE_SESSION_STATUSES } },
      }),
      this.prisma.testSession.count({
        where: { ...campaignFilter, status: SessionStatus.COMPLETED },
      }),
    ]);
    return { total, pending, active, completed };
  }

  private async getFinancialStatsForSeller(sellerId: string) {
    const [totalSpentAgg, escrowAgg] = await Promise.all([
      this.prisma.campaign.aggregate({
        where: {
          sellerId,
          paymentCapturedAt: { not: null },
        },
        _sum: { escrowAmount: true },
      }),
      this.prisma.campaign.aggregate({
        where: { sellerId, status: CampaignStatus.ACTIVE },
        _sum: { escrowAmount: true },
      }),
    ]);

    return {
      totalSpent: Number(totalSpentAgg._sum.escrowAmount ?? 0),
      escrowBalance: Number(escrowAgg._sum.escrowAmount ?? 0),
    };
  }

  private async getMonthlyActivityForSeller(sellerId: string) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const result: Array<{
      month: Date;
      sessions_completed: bigint;
      amount_spent: string;
    }> = await this.prisma.$queryRaw`
      SELECT
        date_trunc('month', ts.completed_at) AS month,
        COUNT(*)::bigint AS sessions_completed,
        COALESCE(SUM(ts.reward_amount), 0)::text AS amount_spent
      FROM test_sessions ts
      JOIN campaigns c ON ts.campaign_id = c.id
      WHERE c.seller_id = ${sellerId}
        AND ts.status = 'COMPLETED'
        AND ts.completed_at >= ${sixMonthsAgo}
      GROUP BY month
      ORDER BY month ASC
    `;

    return result.map((r) => ({
      month: r.month.toISOString().substring(0, 7),
      sessionsCompleted: Number(r.sessions_completed),
      amountSpent: parseFloat(r.amount_spent),
    }));
  }

  // ==========================================================================
  // Admin Dashboard (ADMIN)
  // ==========================================================================

  private async getAdminDashboard() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      userCounts,
      campaignCounts,
      sessionCounts,
      financialStats,
      recentUsers,
      recentDisputes,
      monthlyRevenue,
    ] = await Promise.all([
      this.getUserCounts(startOfMonth),
      this.getAdminCampaignCounts(),
      this.getAdminSessionCounts(),
      this.getAdminFinancialStats(startOfMonth),
      this.prisma.profile.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
        },
      }),
      this.prisma.testSession.findMany({
        where: { status: SessionStatus.DISPUTED },
        orderBy: { disputedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          disputeReason: true,
          disputedAt: true,
          tester: {
            select: { firstName: true, lastName: true },
          },
          campaign: {
            select: {
              title: true,
              seller: { select: { companyName: true } },
            },
          },
        },
      }),
      this.getMonthlyRevenueForAdmin(),
    ]);

    return {
      role: 'ADMIN',
      stats: {
        totalUsers: userCounts.total,
        totalPros: userCounts.pros,
        totalTesters: userCounts.testers,
        newUsersThisMonth: userCounts.newThisMonth,
        totalCampaigns: campaignCounts.total,
        activeCampaigns: campaignCounts.active,
        totalTestSessions: sessionCounts.total,
        completedTestSessions: sessionCounts.completed,
        disputedSessions: sessionCounts.disputed,
        pendingWithdrawals: financialStats.pendingWithdrawals,
        pendingWithdrawalsAmount: financialStats.pendingWithdrawalsAmount,
        totalRevenue: financialStats.totalRevenue,
        revenueThisMonth: financialStats.revenueThisMonth,
        platformBalance: financialStats.platformBalance,
        escrowHeld: financialStats.escrowHeld,
        flaggedUsersCount: userCounts.flagged,
      },
      recentUsers,
      recentDisputes: recentDisputes.map((d) => ({
        id: d.id,
        status: d.status,
        tester: {
          firstName: d.tester.firstName,
          lastName: d.tester.lastName
            ? d.tester.lastName.charAt(0) + '.'
            : null,
        },
        campaign: {
          title: d.campaign.title,
          seller: { companyName: d.campaign.seller.companyName },
        },
        createdAt: d.disputedAt,
      })),
      monthlyRevenue,
    };
  }

  private async getUserCounts(startOfMonth: Date) {
    const [total, pros, testers, newThisMonth, flagged] = await Promise.all([
      this.prisma.profile.count(),
      this.prisma.profile.count({ where: { role: UserRole.PRO } }),
      this.prisma.profile.count({ where: { role: UserRole.USER } }),
      this.prisma.profile.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      this.prisma.profile.count({
        where: { verificationStatus: 'INCOHERENT' },
      }),
    ]);
    return { total, pros, testers, newThisMonth, flagged };
  }

  private async getAdminCampaignCounts() {
    const [total, active] = await Promise.all([
      this.prisma.campaign.count(),
      this.prisma.campaign.count({
        where: { status: CampaignStatus.ACTIVE },
      }),
    ]);
    return { total, active };
  }

  private async getAdminSessionCounts() {
    const [total, completed, disputed] = await Promise.all([
      this.prisma.testSession.count(),
      this.prisma.testSession.count({
        where: { status: SessionStatus.COMPLETED },
      }),
      this.prisma.testSession.count({
        where: { status: SessionStatus.DISPUTED },
      }),
    ]);
    return { total, completed, disputed };
  }

  private async getAdminFinancialStats(startOfMonth: Date) {
    const commissionTypes: TransactionType[] = [
      TransactionType.COMMISSION,
      TransactionType.UGC_COMMISSION,
      TransactionType.TIP_COMMISSION,
      TransactionType.CANCELLATION_COMMISSION,
    ];

    const [
      pendingWithdrawals,
      totalCommissions,
      commissionsThisMonth,
      platformWallet,
      platformBalance,
    ] = await Promise.all([
      this.prisma.withdrawal.aggregate({
        where: {
          status: {
            in: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING],
          },
        },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: { in: commissionTypes },
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: { in: commissionTypes },
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.platformWallet.findFirst(),
      this.getPlatformBalanceSafe(),
    ]);

    return {
      pendingWithdrawals: pendingWithdrawals._count,
      pendingWithdrawalsAmount: Number(
        pendingWithdrawals._sum.amount ?? 0,
      ),
      totalRevenue: Number(totalCommissions._sum.amount ?? 0),
      revenueThisMonth: Number(commissionsThisMonth._sum.amount ?? 0),
      platformBalance,
      escrowHeld: Number(platformWallet?.escrowBalance ?? 0),
    };
  }

  private async getPlatformBalanceSafe(): Promise<number> {
    try {
      const balance = await this.stripeService.getPlatformBalance();
      return (
        balance.available
          .filter((b) => b.currency === 'eur')
          .reduce((sum, b) => sum + b.amount, 0) / 100
      );
    } catch {
      this.logger.warn('Failed to fetch Stripe platform balance');
      return 0;
    }
  }

  private async getMonthlyRevenueForAdmin() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const revenueRows: Array<{
      month: Date;
      revenue: string;
    }> = await this.prisma.$queryRaw`
      SELECT
        date_trunc('month', t.created_at) AS month,
        COALESCE(SUM(t.amount), 0)::text AS revenue
      FROM transactions t
      WHERE t.status = 'COMPLETED'
        AND t.type IN ('COMMISSION', 'UGC_COMMISSION', 'TIP_COMMISSION', 'CANCELLATION_COMMISSION')
        AND t.created_at >= ${sixMonthsAgo}
      GROUP BY month
      ORDER BY month ASC
    `;

    const sessionRows: Array<{
      month: Date;
      sessions_completed: bigint;
    }> = await this.prisma.$queryRaw`
      SELECT
        date_trunc('month', ts.completed_at) AS month,
        COUNT(*)::bigint AS sessions_completed
      FROM test_sessions ts
      WHERE ts.status = 'COMPLETED'
        AND ts.completed_at >= ${sixMonthsAgo}
      GROUP BY month
      ORDER BY month ASC
    `;

    const sessionMap = new Map(
      sessionRows.map((r) => [
        r.month.toISOString().substring(0, 7),
        Number(r.sessions_completed),
      ]),
    );

    return revenueRows.map((r) => {
      const month = r.month.toISOString().substring(0, 7);
      return {
        month,
        revenue: parseFloat(r.revenue),
        commissions: parseFloat(r.revenue),
        sessionsCompleted: sessionMap.get(month) ?? 0,
      };
    });
  }
}
