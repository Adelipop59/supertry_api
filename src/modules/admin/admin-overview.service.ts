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
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const [
      // --- Revenus PRO (ce que les PROs ont paye) ---
      campaignPayments,
      // --- Commissions SuperTry par type ---
      commissionsByType,
      // --- Gains testeurs par type ---
      testerEarningsByType,
      // --- Remboursements ---
      refundsByType,
      // --- Platform wallet (etat actuel) ---
      platformWallet,
      // --- Users ---
      totalUsers,
      totalPros,
      totalTesters,
      // --- Campaigns ---
      campaignsByStatus,
      // --- Sessions ---
      totalSessions,
      completedSessions,
      disputedSessions,
      cancelledSessions,
      // --- Withdrawals ---
      totalWithdrawn,
      pendingWithdrawals,
      // --- User growth ---
      userGrowth,
      // --- Conversion & duration ---
      conversionStats,
      avgSessionDuration,
      // --- Stripe fees delta ---
      businessRules,
    ] = await Promise.all([
      // Total paye par les PROs
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.CAMPAIGN_PAYMENT, status: TransactionStatus.COMPLETED },
        _sum: { amount: true },
        _count: true,
      }),

      // Commissions SuperTry - detail par type
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: {
          type: {
            in: [
              TransactionType.COMMISSION,
              TransactionType.UGC_COMMISSION,
              TransactionType.TIP_COMMISSION,
              TransactionType.CANCELLATION_COMMISSION,
            ],
          },
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
        _count: true,
      }),

      // Gains testeurs - detail par type
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: {
          type: {
            in: [
              TransactionType.PURCHASE_REIMBURSEMENT,
              TransactionType.TEST_REWARD,
              TransactionType.UGC_PAYMENT,
              TransactionType.TIP,
              TransactionType.TESTER_COMPENSATION,
              TransactionType.DISPUTE_RESOLUTION,
            ],
          },
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
        _count: true,
      }),

      // Remboursements vers PROs
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: {
          type: {
            in: [
              TransactionType.CAMPAIGN_REFUND,
              TransactionType.TESTER_CANCELLATION_REFUND,
              TransactionType.REFUND,
            ],
          },
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
        _count: true,
      }),

      // Platform wallet
      this.prisma.platformWallet.findFirst(),

      // Users
      this.prisma.profile.count(),
      this.prisma.profile.count({ where: { role: UserRole.PRO } }),
      this.prisma.profile.count({ where: { role: UserRole.USER } }),

      // Campaigns par statut
      this.prisma.campaign.groupBy({
        by: ['status'],
        _count: true,
      }),

      // Sessions
      this.prisma.testSession.count(),
      this.prisma.testSession.count({ where: { status: SessionStatus.COMPLETED } }),
      this.prisma.testSession.count({ where: { status: SessionStatus.DISPUTED } }),
      this.prisma.testSession.count({ where: { status: SessionStatus.CANCELLED } }),

      // Withdrawals
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.WITHDRAWAL, status: TransactionStatus.COMPLETED },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING] } },
        _sum: { amount: true },
        _count: true,
      }),

      // User growth (12 mois)
      this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
        SELECT date_trunc('month', created_at) AS month, COUNT(*)::bigint AS count
        FROM profiles
        WHERE created_at >= ${twelveMonthsAgo}
        GROUP BY month
        ORDER BY month ASC
      `,

      // Conversion
      this.prisma.$queryRaw<Array<{ total_applied: bigint; total_completed: bigint }>>`
        SELECT
          COUNT(*)::bigint AS total_applied,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS total_completed
        FROM test_sessions
      `,

      // Duree moyenne
      this.prisma.$queryRaw<Array<{ avg_hours: number }>>`
        SELECT EXTRACT(EPOCH FROM AVG(completed_at - applied_at)) / 3600 AS avg_hours
        FROM test_sessions
        WHERE status = 'COMPLETED' AND completed_at IS NOT NULL AND applied_at IS NOT NULL
      `,

      // Business rules pour le stripeFeePercent
      this.prisma.businessRules.findFirst({ where: { isActive: true } }),
    ]);

    // --- Helpers ---
    const sumByType = (groups: Array<{ type: string; _sum: { amount: any }; _count: number }>, type: string) => {
      const found = groups.find((g) => g.type === type);
      return { amount: Number(found?._sum.amount ?? 0), count: found?._count ?? 0 };
    };

    // --- Commissions detail ---
    const commTestCompleted = sumByType(commissionsByType, TransactionType.COMMISSION);
    const commUgc = sumByType(commissionsByType, TransactionType.UGC_COMMISSION);
    const commTip = sumByType(commissionsByType, TransactionType.TIP_COMMISSION);
    const commCancellation = sumByType(commissionsByType, TransactionType.CANCELLATION_COMMISSION);
    const totalCommissions = commTestCompleted.amount + commUgc.amount + commTip.amount + commCancellation.amount;

    // --- Gains testeurs detail ---
    const testerReimbursements = sumByType(testerEarningsByType, TransactionType.PURCHASE_REIMBURSEMENT);
    const testerRewards = sumByType(testerEarningsByType, TransactionType.TEST_REWARD);
    const testerUgc = sumByType(testerEarningsByType, TransactionType.UGC_PAYMENT);
    const testerTips = sumByType(testerEarningsByType, TransactionType.TIP);
    const testerCompensations = sumByType(testerEarningsByType, TransactionType.TESTER_COMPENSATION);
    const testerDisputes = sumByType(testerEarningsByType, TransactionType.DISPUTE_RESOLUTION);
    const totalTesterEarnings = testerReimbursements.amount + testerRewards.amount + testerUgc.amount
      + testerTips.amount + testerCompensations.amount + testerDisputes.amount;

    // --- Remboursements detail ---
    const refundCampaign = sumByType(refundsByType, TransactionType.CAMPAIGN_REFUND);
    const refundTesterCancel = sumByType(refundsByType, TransactionType.TESTER_CANCELLATION_REFUND);
    const refundGeneral = sumByType(refundsByType, TransactionType.REFUND);
    const totalRefunds = refundCampaign.amount + refundTesterCancel.amount + refundGeneral.amount;

    // --- Delta Stripe ---
    // SuperTry preleve stripeFeePercent (3.5%) au PRO mais Stripe prend ses propres frais
    // Le delta = ce que SuperTry a preleve pour couvrir Stripe - ce que Stripe a reellement pris
    // On ne connait pas les frais Stripe exacts ici (faudrait les lire depuis Stripe API),
    // mais on peut calculer ce qui a ete preleve cote SuperTry
    const stripeFeePercent = Number(businessRules?.stripeFeePercent ?? 0.035);
    const totalCampaignAmount = Number(campaignPayments._sum.amount ?? 0);
    // Montant preleve pour couvrir Stripe = totalPaye * stripeFeePercent / (1 + stripeFeePercent)
    const stripeCoverageCollected = totalCampaignAmount > 0
      ? Math.round((totalCampaignAmount * stripeFeePercent / (1 + stripeFeePercent)) * 100) / 100
      : 0;

    // --- Campaigns par statut ---
    const campaignStatusMap: Record<string, number> = {};
    for (const c of campaignsByStatus) {
      campaignStatusMap[c.status] = c._count;
    }

    const conv = conversionStats[0];
    const totalApplied = Number(conv?.total_applied ?? 0);
    const totalCompleted = Number(conv?.total_completed ?? 0);

    return {
      // --- Ce que les PROs ont paye ---
      proSpending: {
        totalCampaignPayments: totalCampaignAmount,
        campaignCount: campaignPayments._count,
      },

      // --- Commissions SuperTry (nos revenus) ---
      commissions: {
        total: totalCommissions,
        testCompleted: commTestCompleted,      // 5€ fixe par test complété
        ugc: commUgc,                          // Commission UGC (photo/video)
        tips: commTip,                         // Commission sur les tips
        cancellations: commCancellation,       // Commission sur annulations testeur (50% de 5€)
      },

      // --- Couverture frais Stripe ---
      stripeFees: {
        percentCharged: stripeFeePercent * 100, // ex: 3.5%
        totalCollectedFromPros: stripeCoverageCollected, // Ce qu'on a preleve aux PROs pour couvrir Stripe
        // Note: le delta reel (collecte - frais Stripe reels) necessite l'API Stripe
        // Voir GET /admin/finance/stripe-balance pour le solde reel
      },

      // --- Gains testeurs ---
      testerEarnings: {
        total: totalTesterEarnings,
        purchaseReimbursements: testerReimbursements,  // Remboursement produit + livraison
        testRewards: testerRewards,                     // Bonus test (testerBonus + proBonus)
        ugcPayments: testerUgc,                         // Paiements UGC
        tips: testerTips,                               // Tips recus
        compensations: testerCompensations,             // Compensation annulation PRO (5€)
        disputeResolutions: testerDisputes,             // Résolution litiges
      },

      // --- Remboursements PROs ---
      refunds: {
        total: totalRefunds,
        campaignRefunds: refundCampaign,                // Slots non utilises + delta prix
        testerCancellationRefunds: refundTesterCancel,  // Remboursement apres annulation testeur
        generalRefunds: refundGeneral,                  // Remboursements manuels
      },

      // --- Platform wallet (etat temps reel) ---
      platformWallet: {
        escrowBalance: Number(platformWallet?.escrowBalance ?? 0),       // Argent bloque pour campagnes actives
        commissionBalance: Number(platformWallet?.commissionBalance ?? 0), // Commissions accumulees
        totalReceived: Number(platformWallet?.totalReceived ?? 0),       // Total recu des PROs (all time)
        totalTransferred: Number(platformWallet?.totalTransferred ?? 0), // Total envoye aux testeurs (all time)
        totalCommissions: Number(platformWallet?.totalCommissions ?? 0), // Total commissions (all time)
      },

      // --- Withdrawals testeurs ---
      withdrawals: {
        totalWithdrawn: Number(totalWithdrawn._sum.amount ?? 0),
        withdrawalCount: totalWithdrawn._count,
        pendingAmount: Number(pendingWithdrawals._sum.amount ?? 0),
        pendingCount: pendingWithdrawals._count,
      },

      // --- Users ---
      users: {
        total: totalUsers,
        pros: totalPros,
        testers: totalTesters,
      },

      // --- Campaigns par statut ---
      campaigns: {
        total: Object.values(campaignStatusMap).reduce((a, b) => a + b, 0),
        byStatus: campaignStatusMap,
      },

      // --- Sessions ---
      sessions: {
        total: totalSessions,
        completed: completedSessions,
        disputed: disputedSessions,
        cancelled: cancelledSessions,
        conversionRate: totalApplied > 0
          ? Math.round((totalCompleted / totalApplied) * 10000) / 100
          : 0,
        avgDurationHours: avgSessionDuration[0]?.avg_hours
          ? Math.round(avgSessionDuration[0].avg_hours * 10) / 10
          : null,
      },

      // --- Croissance users (12 mois) ---
      userGrowth: userGrowth.map((r) => ({
        month: r.month.toISOString().substring(0, 7),
        count: Number(r.count),
      })),
    };
  }
}
