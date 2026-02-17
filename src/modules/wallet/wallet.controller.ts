import { Controller, Get, Post, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @ApiOperation({ summary: 'Récupérer mon portefeuille' })
  @ApiResponse({ status: 200, description: 'Portefeuille récupéré avec succès' })
  @ApiAuthResponses()
  @Get('me')
  @Roles(UserRole.PRO, UserRole.USER)
  async getMyWallet(@CurrentUser('id') userId: string) {
    const wallet = await this.walletService.getWallet(userId);

    return {
      balance: wallet.balance.toNumber(),
      pendingBalance: wallet.pendingBalance.toNumber(),
      totalEarned: wallet.totalEarned.toNumber(),
      totalWithdrawn: wallet.totalWithdrawn.toNumber(),
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
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
      transactions: walletWithTransactions.transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toNumber(),
        reason: tx.reason,
        status: tx.status,
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
