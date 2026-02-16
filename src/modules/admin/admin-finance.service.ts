import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import {
  TransactionType,
  TransactionStatus,
  CampaignStatus,
  WithdrawalStatus,
} from '@prisma/client';
import { BalanceTransactionsQueryDto } from './dto/balance-transactions-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';
import { CampaignBreakdownResponseDto } from './dto/campaign-breakdown-response.dto';
import { RevenueQueryDto, RevenueGranularity } from './dto/revenue-query.dto';
import { RevenueResponseDto } from './dto/revenue-response.dto';
import Stripe from 'stripe';

@Injectable()
export class AdminFinanceService {
  private readonly logger = new Logger(AdminFinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  // ============================================================================
  // Option 2: Balance Transactions Stripe enrichies
  // ============================================================================

  async listBalanceTransactions(query: BalanceTransactionsQueryDto) {
    const created: { gte?: number; lte?: number } = {};
    if (query.from) created.gte = Math.floor(new Date(query.from).getTime() / 1000);
    if (query.to) created.lte = Math.floor(new Date(query.to).getTime() / 1000);

    const stripeResult = await this.stripeService.listBalanceTransactions({
      limit: query.limit,
      startingAfter: query.startingAfter,
      endingBefore: query.endingBefore,
      created: Object.keys(created).length > 0 ? created : undefined,
      type: query.type,
    });

    const enriched = await Promise.all(
      stripeResult.data.map(async (bt) => {
        const localTransaction = await this.matchLocalTransaction(bt);

        return {
          id: bt.id,
          type: bt.type,
          amount: bt.amount / 100,
          fee: bt.fee / 100,
          net: bt.net / 100,
          currency: bt.currency,
          created: new Date(bt.created * 1000),
          description: bt.description,
          status: bt.status,
          // Enrichissement local
          local: localTransaction
            ? {
                id: localTransaction.id,
                type: localTransaction.type,
                reason: localTransaction.reason,
                campaignId: localTransaction.campaignId,
                sessionId: localTransaction.sessionId,
                metadata: localTransaction.metadata,
              }
            : null,
        };
      }),
    );

    return {
      data: enriched,
      hasMore: stripeResult.has_more,
      count: enriched.length,
    };
  }

  async getStripeBalance() {
    const balance = await this.stripeService.getPlatformBalance();
    return {
      available: balance.available.map((b) => ({
        amount: b.amount / 100,
        currency: b.currency,
      })),
      pending: balance.pending.map((b) => ({
        amount: b.amount / 100,
        currency: b.currency,
      })),
    };
  }

  private async matchLocalTransaction(bt: Stripe.BalanceTransaction) {
    const source = bt.source;
    const sourceId = typeof source === 'string' ? source : source?.id;
    if (!sourceId) return null;

    // Charge → match via PaymentIntent
    if (sourceId.startsWith('ch_')) {
      const sourceObj = source as Stripe.Charge;
      const paymentIntentId =
        typeof sourceObj.payment_intent === 'string'
          ? sourceObj.payment_intent
          : sourceObj.payment_intent?.id;

      if (paymentIntentId) {
        return this.prisma.transaction.findFirst({
          where: { stripePaymentIntentId: paymentIntentId },
        });
      }
    }

    // Transfer → match via stripeTransferId
    if (sourceId.startsWith('tr_')) {
      return this.prisma.transaction.findFirst({
        where: { stripeTransferId: sourceId },
      });
    }

    // Refund → match via stripeRefundId
    if (sourceId.startsWith('re_')) {
      return this.prisma.transaction.findFirst({
        where: { stripeRefundId: sourceId },
      });
    }

    return null;
  }

  // ============================================================================
  // Option 3: Dashboard financier (données locales)
  // ============================================================================

  async getDashboard(period: 'day' | 'week' | 'month' = 'month'): Promise<DashboardResponseDto> {
    const now = new Date();
    const periodStart = this.getPeriodStart(now, period);

    const [
      platformWallet,
      periodTransactions,
      commissionBreakdown,
      activeCampaignsCount,
      pendingWithdrawals,
    ] = await Promise.all([
      this.prisma.platformWallet.findFirst(),
      this.prisma.transaction.aggregate({
        where: {
          createdAt: { gte: periodStart },
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
        _count: true,
      }),
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
          createdAt: { gte: periodStart },
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.campaign.count({
        where: { status: CampaignStatus.ACTIVE },
      }),
      this.prisma.withdrawal.aggregate({
        where: {
          status: {
            in: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING],
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      platformWallet: {
        escrowBalance: Number(platformWallet?.escrowBalance ?? 0),
        commissionBalance: Number(platformWallet?.commissionBalance ?? 0),
        totalReceived: Number(platformWallet?.totalReceived ?? 0),
        totalTransferred: Number(platformWallet?.totalTransferred ?? 0),
        totalCommissions: Number(platformWallet?.totalCommissions ?? 0),
      },
      periodStats: {
        period: `${periodStart.toISOString()} - ${now.toISOString()}`,
        totalAmount: Number(periodTransactions._sum.amount ?? 0),
        transactionCount: periodTransactions._count,
      },
      commissionBreakdown: commissionBreakdown.map((item) => ({
        type: item.type,
        total: Number(item._sum.amount ?? 0),
        count: item._count,
      })),
      activeCampaigns: activeCampaignsCount,
      pendingWithdrawals: {
        amount: Number(pendingWithdrawals._sum.amount ?? 0),
        count: pendingWithdrawals._count,
      },
    };
  }

  async getCampaignBreakdown(campaignId: string): Promise<CampaignBreakdownResponseDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        seller: { select: { id: true, email: true, firstName: true } },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const transactions = await this.prisma.transaction.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });

    // Agréger par type
    const byType: Record<string, { total: number; count: number }> = {};
    for (const tx of transactions) {
      if (!byType[tx.type]) byType[tx.type] = { total: 0, count: 0 };
      byType[tx.type].total += Number(tx.amount);
      byType[tx.type].count += 1;
    }

    const totalPaid = byType[TransactionType.CAMPAIGN_PAYMENT]?.total ?? 0;
    const totalRefunded =
      (byType[TransactionType.CAMPAIGN_REFUND]?.total ?? 0) +
      (byType[TransactionType.TESTER_CANCELLATION_REFUND]?.total ?? 0);
    const totalRewarded = byType[TransactionType.TEST_REWARD]?.total ?? 0;
    const totalCommissions =
      (byType[TransactionType.COMMISSION]?.total ?? 0) +
      (byType[TransactionType.CANCELLATION_COMMISSION]?.total ?? 0) +
      (byType[TransactionType.UGC_COMMISSION]?.total ?? 0) +
      (byType[TransactionType.TIP_COMMISSION]?.total ?? 0);
    const totalCompensations = byType[TransactionType.TESTER_COMPENSATION]?.total ?? 0;

    return {
      campaign: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        totalSlots: campaign.totalSlots,
        sellerId: campaign.sellerId,
        sellerEmail: campaign.seller.email,
      },
      financial: {
        totalPaid,
        totalRefunded,
        totalRewarded,
        totalCommissions,
        totalCompensations,
        escrowRemaining: totalPaid - totalRefunded - totalRewarded - totalCommissions - totalCompensations,
      },
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        reason: tx.reason,
        createdAt: tx.createdAt,
        stripeId: tx.stripePaymentIntentId || tx.stripeTransferId || tx.stripeRefundId || undefined,
      })),
      pnl: {
        revenue: totalCommissions,
        costs: totalCompensations,
        netProfit: totalCommissions - totalCompensations,
      },
    };
  }

  async getRevenue(query: RevenueQueryDto): Promise<RevenueResponseDto> {
    const granularity = query.granularity || RevenueGranularity.DAY;
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();

    const result: Array<{ period: Date; type: string; total: string; count: bigint }> =
      await this.prisma.$queryRaw`
        SELECT
          date_trunc(${granularity}, created_at) as period,
          type,
          SUM(amount)::text as total,
          COUNT(*) as count
        FROM transactions
        WHERE status = 'COMPLETED'
          AND created_at >= ${from}
          AND created_at <= ${to}
        GROUP BY period, type
        ORDER BY period ASC
      `;

    // Grouper par période
    const periodMap = new Map<string, { breakdown: { type: string; total: number; count: number }[]; total: number }>();

    for (const row of result) {
      const periodKey = new Date(row.period).toISOString().split('T')[0];
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, { breakdown: [], total: 0 });
      }
      const entry = periodMap.get(periodKey)!;
      const amount = parseFloat(row.total);
      entry.breakdown.push({
        type: row.type,
        total: amount,
        count: Number(row.count),
      });
      entry.total += amount;
    }

    const periods = Array.from(periodMap.entries()).map(([period, data]) => ({
      period,
      breakdown: data.breakdown,
      total: data.total,
    }));

    const grandTotal = periods.reduce((sum, p) => sum + p.total, 0);

    return { periods, grandTotal };
  }

  private getPeriodStart(now: Date, period: 'day' | 'week' | 'month'): Date {
    const start = new Date(now);
    switch (period) {
      case 'day':
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
    }
    return start;
  }
}
