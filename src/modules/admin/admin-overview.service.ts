import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResponse } from '../../common/dto/pagination.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { AdminCampaignsQueryDto } from './dto/admin-campaigns-query.dto';
import { AdminProductsQueryDto } from './dto/admin-products-query.dto';
import {
  TransactionType,
  TransactionStatus,
  CampaignStatus,
  SessionStatus,
  WithdrawalStatus,
  UserRole,
} from '@prisma/client';

@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================================
  // Users
  // ============================================================================

  async listUsers(query: AdminUsersQueryDto) {
    const { page = 1, limit = 10, search, role, isActive, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive;

    const allowedSorts = ['createdAt', 'email', 'firstName', 'role'];
    const orderField = allowedSorts.includes(sortBy) ? sortBy : 'createdAt';

    const [data, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderField]: sortOrder },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          isVerified: true,
          isOnboarded: true,
          createdAt: true,
          completedSessionsCount: true,
          averageRating: true,
          companyName: true,
          stripeOnboardingCompleted: true,
        },
      }),
      this.prisma.profile.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, limit);
  }

  async getUserDetail(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        isVerified: true,
        isOnboarded: true,
        createdAt: true,
        completedSessionsCount: true,
        averageRating: true,
        companyName: true,
        stripeConnectAccountId: true,
        stripeOnboardingCompleted: true,
        stripeIdentityVerified: true,
        authProvider: true,
      },
    });

    if (!profile) throw new NotFoundException('User not found');

    const [wallet, sessionCounts, campaignCount] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true, pendingBalance: true, totalEarned: true, totalWithdrawn: true },
      }),
      this.prisma.testSession.groupBy({
        by: ['status'],
        where: { testerId: userId },
        _count: true,
      }),
      profile.role === UserRole.PRO
        ? this.prisma.campaign.count({ where: { sellerId: userId } })
        : null,
    ]);

    const sessionCountMap: Record<string, number> = {};
    for (const s of sessionCounts) {
      sessionCountMap[s.status] = s._count;
    }

    return {
      profile,
      wallet: wallet
        ? {
            balance: Number(wallet.balance),
            pendingBalance: Number(wallet.pendingBalance),
            totalEarned: Number(wallet.totalEarned),
            totalWithdrawn: Number(wallet.totalWithdrawn),
          }
        : null,
      sessions: sessionCountMap,
      campaignCount,
    };
  }

  // ============================================================================
  // Campaigns
  // ============================================================================

  async listCampaigns(query: AdminCampaignsQueryDto) {
    const { page = 1, limit = 10, search, status, sellerId, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }
    if (status) where.status = status;
    if (sellerId) where.sellerId = sellerId;

    const allowedSorts = ['createdAt', 'title', 'status', 'totalSlots', 'escrowAmount'];
    const orderField = allowedSorts.includes(sortBy) ? sortBy : 'createdAt';

    const [data, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderField]: sortOrder },
        select: {
          id: true,
          title: true,
          status: true,
          totalSlots: true,
          availableSlots: true,
          escrowAmount: true,
          createdAt: true,
          startDate: true,
          endDate: true,
          completedAt: true,
          cancelledAt: true,
          seller: {
            select: { id: true, email: true, firstName: true, companyName: true },
          },
          category: { select: { id: true, name: true } },
          _count: {
            select: {
              testSessions: true,
            },
          },
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    const formatted = data.map((c) => ({
      ...c,
      escrowAmount: Number(c.escrowAmount),
      filledSlots: c.totalSlots - c.availableSlots,
      testSessionCount: c._count.testSessions,
    }));

    return createPaginatedResponse(formatted, total, page, limit);
  }

  async getCampaignDetail(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        seller: {
          select: { id: true, email: true, firstName: true, lastName: true, companyName: true },
        },
        category: { select: { id: true, name: true } },
        offers: {
          include: {
            product: { select: { id: true, name: true, price: true } },
          },
        },
        _count: {
          select: { testSessions: true },
        },
      },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');

    const sessionsByStatus = await this.prisma.testSession.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: true,
    });

    const transactions = await this.prisma.transaction.aggregate({
      where: { campaignId, status: TransactionStatus.COMPLETED },
      _sum: { amount: true },
      _count: true,
    });

    return {
      campaign: {
        ...campaign,
        escrowAmount: Number(campaign.escrowAmount),
      },
      sessionsByStatus: sessionsByStatus.reduce(
        (acc, s) => ({ ...acc, [s.status]: s._count }),
        {} as Record<string, number>,
      ),
      financialSummary: {
        totalTransactions: transactions._count,
        totalAmount: Number(transactions._sum.amount ?? 0),
      },
    };
  }

  // ============================================================================
  // Products
  // ============================================================================

  async listProducts(query: AdminProductsQueryDto) {
    const { page = 1, limit = 10, search, sellerId, categoryId, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (sellerId) where.sellerId = sellerId;
    if (categoryId) where.categoryId = categoryId;

    const allowedSorts = ['createdAt', 'name', 'price'];
    const orderField = allowedSorts.includes(sortBy) ? sortBy : 'createdAt';

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderField]: sortOrder },
        select: {
          id: true,
          name: true,
          description: true,
          asin: true,
          price: true,
          shippingCost: true,
          isActive: true,
          createdAt: true,
          seller: {
            select: { id: true, email: true, firstName: true, companyName: true },
          },
          category: { select: { id: true, name: true } },
          _count: { select: { offers: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const formatted = data.map((p) => ({
      ...p,
      price: Number(p.price),
      shippingCost: Number(p.shippingCost),
      campaignCount: p._count.offers,
    }));

    return createPaginatedResponse(formatted, total, page, limit);
  }

  // ============================================================================
  // Global Stats / KPIs
  // ============================================================================

  async getGlobalStats() {
    const commissionTypes: TransactionType[] = [
      TransactionType.COMMISSION,
      TransactionType.UGC_COMMISSION,
      TransactionType.TIP_COMMISSION,
      TransactionType.CANCELLATION_COMMISSION,
    ];

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const [
      totalCampaignSpending,
      marginsCollected,
      platformWallet,
      totalUsers,
      totalPros,
      totalTesters,
      totalCampaigns,
      activeCampaigns,
      totalSessions,
      completedSessions,
      disputedSessions,
      totalWithdrawn,
      pendingWithdrawals,
      userGrowth,
      conversionStats,
      avgSessionDuration,
    ] = await Promise.all([
      // Total depense en campagnes
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.CAMPAIGN_PAYMENT,
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
      }),

      // Marges SuperTry recuperees
      this.prisma.transaction.aggregate({
        where: {
          type: { in: commissionTypes },
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
        _count: true,
      }),

      // Platform wallet (escrow = marges pas encore recuperees)
      this.prisma.platformWallet.findFirst(),

      // User counts
      this.prisma.profile.count(),
      this.prisma.profile.count({ where: { role: UserRole.PRO } }),
      this.prisma.profile.count({ where: { role: UserRole.USER } }),

      // Campaign counts
      this.prisma.campaign.count(),
      this.prisma.campaign.count({ where: { status: CampaignStatus.ACTIVE } }),

      // Session counts
      this.prisma.testSession.count(),
      this.prisma.testSession.count({ where: { status: SessionStatus.COMPLETED } }),
      this.prisma.testSession.count({ where: { status: SessionStatus.DISPUTED } }),

      // Withdrawals
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING] } },
        _sum: { amount: true },
        _count: true,
      }),

      // User growth (12 derniers mois)
      this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
        SELECT date_trunc('month', created_at) AS month, COUNT(*)::bigint AS count
        FROM profiles
        WHERE created_at >= ${twelveMonthsAgo}
        GROUP BY month
        ORDER BY month ASC
      `,

      // Conversion : applications -> completions
      this.prisma.$queryRaw<Array<{ total_applied: bigint; total_completed: bigint }>>`
        SELECT
          COUNT(*)::bigint AS total_applied,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS total_completed
        FROM test_sessions
      `,

      // Duree moyenne de session (appliedAt -> completedAt)
      this.prisma.$queryRaw<Array<{ avg_hours: number }>>`
        SELECT EXTRACT(EPOCH FROM AVG(completed_at - applied_at)) / 3600 AS avg_hours
        FROM test_sessions
        WHERE status = 'COMPLETED' AND completed_at IS NOT NULL AND applied_at IS NOT NULL
      `,
    ]);

    const conv = conversionStats[0];
    const totalApplied = Number(conv?.total_applied ?? 0);
    const totalCompleted = Number(conv?.total_completed ?? 0);

    return {
      financial: {
        totalCampaignSpending: Number(totalCampaignSpending._sum.amount ?? 0),
        marginsCollected: Number(marginsCollected._sum.amount ?? 0),
        marginsCollectedCount: marginsCollected._count,
        escrowBalance: Number(platformWallet?.escrowBalance ?? 0),
        commissionBalance: Number(platformWallet?.commissionBalance ?? 0),
        totalReceived: Number(platformWallet?.totalReceived ?? 0),
        totalTransferred: Number(platformWallet?.totalTransferred ?? 0),
        totalWithdrawn: Number(totalWithdrawn._sum.amount ?? 0),
        pendingWithdrawalsAmount: Number(pendingWithdrawals._sum.amount ?? 0),
        pendingWithdrawalsCount: pendingWithdrawals._count,
      },
      users: {
        total: totalUsers,
        pros: totalPros,
        testers: totalTesters,
      },
      campaigns: {
        total: totalCampaigns,
        active: activeCampaigns,
      },
      sessions: {
        total: totalSessions,
        completed: completedSessions,
        disputed: disputedSessions,
        conversionRate: totalApplied > 0
          ? Math.round((totalCompleted / totalApplied) * 10000) / 100
          : 0,
        avgDurationHours: avgSessionDuration[0]?.avg_hours
          ? Math.round(avgSessionDuration[0].avg_hours * 10) / 10
          : null,
      },
      userGrowth: userGrowth.map((r) => ({
        month: r.month.toISOString().substring(0, 7),
        count: Number(r.count),
      })),
    };
  }
}
