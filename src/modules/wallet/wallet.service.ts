import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { Wallet, Transaction, AuditCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly auditService: AuditService,
  ) {}

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  async createWallet(userId: string): Promise<Wallet> {
    const existingWallet = await this.prisma.wallet.findUnique({
      where: { userId: userId },
    });

    if (existingWallet) {
      return existingWallet;
    }

    const wallet = await this.prisma.wallet.create({
      data: {
        userId,
        balance: new Decimal(0),
        pendingBalance: new Decimal(0),
        totalEarned: new Decimal(0),
        totalWithdrawn: new Decimal(0),
      },
    });

    this.logger.log(`Wallet created for user ${userId}`);
    return wallet;
  }

  async getWallet(userId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  async getWalletWithTransactions(
    userId: string,
    limit: number = 50,
  ): Promise<Wallet & { transactions: Transaction[] }> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: limit,
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  // ============================================================================
  // Balance Management
  // ============================================================================

  async addPendingBalance(
    userId: string,
    amount: number,
    description: string,
  ): Promise<Wallet> {
    const wallet = await this.prisma.wallet.update({
      where: { userId: userId },
      data: {
        pendingBalance: {
          increment: new Decimal(amount),
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      AuditCategory.WALLET,
      'PENDING_BALANCE_ADDED',
      {
        amount,
        description,
        newPendingBalance: wallet.pendingBalance.toNumber(),
      },
    );

    this.logger.log(`Added ${amount}€ to pending balance for user ${userId}`);
    return wallet;
  }

  async releasePendingBalance(userId: string, amount: number): Promise<Wallet> {
    const wallet = await this.getWallet(userId);

    if (wallet.pendingBalance.toNumber() < amount) {
      throw new BadRequestException('Insufficient pending balance');
    }

    const updatedWallet = await this.prisma.wallet.update({
      where: { userId: userId },
      data: {
        pendingBalance: {
          decrement: new Decimal(amount),
        },
        balance: {
          increment: new Decimal(amount),
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      AuditCategory.WALLET,
      'PENDING_BALANCE_RELEASED',
      {
        amount,
        newPendingBalance: updatedWallet.pendingBalance.toNumber(),
        newBalance: updatedWallet.balance.toNumber(),
      },
    );

    this.logger.log(`Released ${amount}€ from pending to available for user ${userId}`);
    return updatedWallet;
  }

  async addAvailableBalance(
    userId: string,
    amount: number,
    description: string,
  ): Promise<Wallet> {
    const wallet = await this.prisma.wallet.update({
      where: { userId: userId },
      data: {
        balance: {
          increment: new Decimal(amount),
        },
        totalEarned: {
          increment: new Decimal(amount),
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      AuditCategory.WALLET,
      'AVAILABLE_BALANCE_ADDED',
      {
        amount,
        description,
        newBalance: wallet.balance.toNumber(),
        totalEarned: wallet.totalEarned.toNumber(),
      },
    );

    this.logger.log(`Added ${amount}€ to available balance for user ${userId}`);
    return wallet;
  }

  async deductBalance(
    userId: string,
    amount: number,
    description: string,
  ): Promise<Wallet> {
    const wallet = await this.getWallet(userId);

    if (wallet.balance.toNumber() < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    const updatedWallet = await this.prisma.wallet.update({
      where: { userId: userId },
      data: {
        balance: {
          decrement: new Decimal(amount),
        },
        totalWithdrawn: {
          increment: new Decimal(amount),
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      AuditCategory.WALLET,
      'BALANCE_DEDUCTED',
      {
        amount,
        description,
        newBalance: updatedWallet.balance.toNumber(),
        totalWithdrawn: updatedWallet.totalWithdrawn.toNumber(),
      },
    );

    this.logger.log(`Deducted ${amount}€ from balance for user ${userId}`);
    return updatedWallet;
  }

  // ============================================================================
  // Stripe Correlation
  // ============================================================================

  async syncWithStripeConnect(userId: string): Promise<{
    walletBalance: number;
    walletPending: number;
    stripeBalance: number;
    totalAvailable: number;
  }> {
    const wallet = await this.getWallet(userId);

    // Get Stripe Connect account
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      return {
        walletBalance: wallet.balance.toNumber(),
        walletPending: wallet.pendingBalance.toNumber(),
        stripeBalance: 0,
        totalAvailable: wallet.balance.toNumber(),
      };
    }

    try {
      const stripeBalance = await this.stripeService.getConnectAccountBalance(
        profile.stripeConnectAccountId,
      );

      const stripeAvailable = stripeBalance.available[0]?.amount || 0;
      const stripeAvailableEur = stripeAvailable / 100; // Convert from cents

      // Audit log
      await this.auditService.log(
        userId,
        AuditCategory.WALLET,
        'STRIPE_BALANCE_SYNC',
        {
          walletBalance: wallet.balance.toNumber(),
          walletPending: wallet.pendingBalance.toNumber(),
          stripeBalance: stripeAvailableEur,
          totalAvailable: wallet.balance.toNumber() + stripeAvailableEur,
        },
      );

      return {
        walletBalance: wallet.balance.toNumber(),
        walletPending: wallet.pendingBalance.toNumber(),
        stripeBalance: stripeAvailableEur,
        totalAvailable: wallet.balance.toNumber() + stripeAvailableEur,
      };
    } catch (error) {
      this.logger.error(`Failed to sync Stripe balance for user ${userId}: ${error.message}`);
      return {
        walletBalance: wallet.balance.toNumber(),
        walletPending: wallet.pendingBalance.toNumber(),
        stripeBalance: 0,
        totalAvailable: wallet.balance.toNumber(),
      };
    }
  }
}
