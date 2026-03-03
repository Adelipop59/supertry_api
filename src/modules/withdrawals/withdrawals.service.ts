import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  WithdrawalStatus,
  AuditCategory,
  NotificationType,
} from '@prisma/client';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { Decimal } from '@prisma/client/runtime/library';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Demander un retrait vers IBAN (Stripe Payout)
   */
  async createWithdrawal(userId: string, amount: number): Promise<any> {
    // 1. Get wallet
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new I18nHttpException('wallet.not_found', 'WALLET_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (Number(wallet.balance) < amount) {
      throw new I18nHttpException('wallet.insufficient_balance', 'WALLET_INSUFFICIENT_BALANCE', HttpStatus.BAD_REQUEST);
    }

    // 2. Get profile
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        stripeConnectAccountId: true,
      },
    });

    if (!profile) {
      throw new I18nHttpException('auth.profile_not_found', 'PROFILE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.BAD_REQUEST);
    }

    // 3. Créer Withdrawal PENDING
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      // Créer withdrawal
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amount: new Decimal(amount),
          status: WithdrawalStatus.PENDING,
          method: 'BANK_TRANSFER',
        },
      });

      // Déduire du wallet (réserver)
      await tx.wallet.update({
        where: { userId },
        data: {
          balance: {
            decrement: new Decimal(amount),
          },
        },
      });

      return withdrawal;
    });

    // 4. Créer Stripe Payout
    try {
      const payout = await this.stripeService.createPayout(
        amount,
        profile.stripeConnectAccountId,
        'eur',
        { withdrawalId: withdrawal.id, userId },
      );

      // Update withdrawal avec Stripe Payout ID
      const updatedWithdrawal = await this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          stripePayoutId: payout.id,
          status: WithdrawalStatus.PROCESSING,
          processedAt: new Date(),
        },
      });

      // Audit
      await this.auditService.log(
        userId,
        AuditCategory.WALLET,
        'WITHDRAWAL_INITIATED',
        {
          withdrawalId: withdrawal.id,
          amount,
          stripePayoutId: payout.id,
        },
      );

      // Notification
      await this.notificationsService.queueEmail({
        to: profile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Withdrawal Initiated',
        variables: {
          firstName: profile.firstName!,
          amount: amount.toString(),
          message: `Your withdrawal of ${amount}€ is being processed. It will arrive in your bank account within 2-3 business days.`,
        },
        metadata: {
          withdrawalId: withdrawal.id,
          type: NotificationType.PAYMENT_RECEIVED,
        },
      });

      return updatedWithdrawal;
    } catch (error) {
      this.logger.error(
        `Payout creation failed: ${error.message}`,
        error.stack,
      );

      // Rendre l'argent si payout échoue
      await this.prisma.$transaction(async (tx) => {
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: WithdrawalStatus.FAILED,
            failureReason: error.message,
          },
        });

        await tx.wallet.update({
          where: { userId },
          data: {
            balance: {
              increment: new Decimal(amount),
            },
          },
        });
      });

      throw error;
    }
  }

  /**
   * Annuler un retrait
   */
  async cancelWithdrawal(
    withdrawalId: string,
    userId: string,
    reason: string,
  ): Promise<any> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal || withdrawal.userId !== userId) {
      throw new I18nHttpException('wallet.withdrawal_not_found', 'WITHDRAWAL_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new I18nHttpException('wallet.cannot_cancel', 'WITHDRAWAL_CANNOT_CANCEL', HttpStatus.BAD_REQUEST);
    }

    // Rendre l'argent
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: WithdrawalStatus.CANCELLED,
          failureReason: reason,
        },
      });

      await tx.wallet.update({
        where: { userId },
        data: {
          balance: {
            increment: withdrawal.amount,
          },
        },
      });

      return withdrawal;
    });

    await this.auditService.log(
      userId,
      AuditCategory.WALLET,
      'WITHDRAWAL_CANCELLED',
      {
        withdrawalId,
        amount: Number(withdrawal.amount),
        reason,
      },
    );

    return cancelled;
  }

  /**
   * Lister retraits user
   */
  async getUserWithdrawals(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const [withdrawals, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.withdrawal.count({
        where: { userId },
      }),
    ]);

    return {
      items: withdrawals,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Get un retrait spécifique
   */
  async getWithdrawal(withdrawalId: string, userId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal || withdrawal.userId !== userId) {
      throw new I18nHttpException('wallet.withdrawal_not_found', 'WITHDRAWAL_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    return withdrawal;
  }
}
