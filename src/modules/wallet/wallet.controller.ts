import { Controller, Get, Post, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';
import { UserRole } from '@prisma/client';
import { StripeService } from '../stripe/stripe.service';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Récupérer mon portefeuille' })
  @ApiResponse({ status: 200, description: 'Portefeuille récupéré avec succès' })
  @ApiAuthResponses()
  @Get('me')
  @Roles(UserRole.PRO, UserRole.USER)
  async getMyWallet(@CurrentUser('id') userId: string) {
    const wallet = await this.walletService.getWallet(userId);

    // Récupérer les infos Stripe pour le solde disponible pour retrait
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    let stripeAvailable = 0;
    let stripePending = 0;
    let pendingPayments: {
      amount: number;
      availableOn: string;
      description: string | null;
      campaignTitle: string | null;
    }[] = [];

    if (profile?.stripeConnectAccountId) {
      try {
        const stripeBalance = await this.stripeService.getConnectAccountBalance(
          profile.stripeConnectAccountId,
        );
        stripeAvailable = stripeBalance.available
          .filter((b) => b.currency === 'eur')
          .reduce((sum, b) => sum + b.amount, 0) / 100;
        stripePending = stripeBalance.pending
          .filter((b) => b.currency === 'eur')
          .reduce((sum, b) => sum + b.amount, 0) / 100;

        // Récupérer le détail de chaque transaction pending avec sa date de disponibilité
        if (stripePending > 0) {
          try {
            const balanceTxns = await this.stripeService.getConnectBalanceTransactions(
              profile.stripeConnectAccountId,
              { limit: 50 },
            );
            const pendingTxns = balanceTxns.data.filter((t) => t.status === 'pending');

            // Matcher avec nos transactions internes pour récupérer le nom de la campagne
            const transferIds = pendingTxns
              .map((t) => typeof t.source === 'string' ? t.source : t.source?.id)
              .filter(Boolean) as string[];

            const internalTxns = transferIds.length > 0
              ? await this.prisma.transaction.findMany({
                  where: { stripeTransferId: { in: transferIds } },
                  select: {
                    stripeTransferId: true,
                    reason: true,
                    campaign: { select: { title: true } },
                  },
                })
              : [];

            const txnMap = new Map(
              internalTxns.map((t) => [t.stripeTransferId, t]),
            );

            pendingPayments = pendingTxns.map((t) => {
              const sourceId = typeof t.source === 'string' ? t.source : t.source?.id;
              const internal = sourceId ? txnMap.get(sourceId) : null;
              return {
                amount: t.amount / 100,
                availableOn: new Date(t.available_on * 1000).toISOString(),
                description: internal?.reason || t.description,
                campaignTitle: internal?.campaign?.title || null,
              };
            });
          } catch {
            // Silencieux
          }
        }
      } catch {
        // Silencieux si Stripe indisponible
      }
    }

    return {
      balance: wallet.balance.toNumber(),
      pendingBalance: wallet.pendingBalance.toNumber(),
      totalEarned: wallet.totalEarned.toNumber(),
      totalWithdrawn: wallet.totalWithdrawn.toNumber(),
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      stripe: {
        availableForPayout: stripeAvailable,
        pendingFunds: stripePending,
        pendingPayments,
      },
    };
  }

  @ApiOperation({ summary: 'Récupérer mes transactions' })
  @ApiResponse({ status: 200, description: 'Transactions récupérées avec succès' })
  @ApiAuthResponses()
  @Get('me/transactions')
  @Roles(UserRole.PRO, UserRole.USER)
  async getMyTransactions(
    @CurrentUser('id') userId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const walletWithTransactions = await this.walletService.getWalletWithTransactions(
      userId,
      limit || 50,
    );

    return {
      wallet: {
        balance: walletWithTransactions.balance.toNumber(),
        pendingBalance: walletWithTransactions.pendingBalance.toNumber(),
        totalEarned: walletWithTransactions.totalEarned.toNumber(),
        totalWithdrawn: walletWithTransactions.totalWithdrawn.toNumber(),
      },
      transactions: walletWithTransactions.transactions.map((tx: any) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toNumber(),
        reason: tx.reason,
        status: tx.status,
        campaignId: tx.campaignId,
        campaignTitle: tx.campaign?.title || null,
        sessionId: tx.sessionId,
        createdAt: tx.createdAt,
        metadata: tx.metadata,
      })),
    };
  }

  @ApiOperation({ summary: 'Synchroniser le portefeuille avec Stripe Connect' })
  @ApiResponse({ status: 201, description: 'Synchronisation effectuée avec succès' })
  @ApiAuthResponses()
  @Post('me/sync')
  @Roles(UserRole.PRO, UserRole.USER)
  async syncWithStripe(@CurrentUser('id') userId: string) {
    return this.walletService.syncWithStripeConnect(userId);
  }
}
