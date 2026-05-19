import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PostHogService } from '../posthog/posthog.service';
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
    private readonly posthog: PostHogService,
  ) {}

  /**
   * Demander un retrait vers IBAN (Stripe Payout)
   */
  async createWithdrawal(userId: string, amount: number): Promise<any> {
    // 1. Vérifier le profil (KYC + Connect onboarding obligatoires)
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        stripeConnectAccountId: true,
        stripeOnboardingCompleted: true,
        stripeIdentityVerified: true,
      },
    });

    if (!profile) {
      throw new I18nHttpException(
        'auth.profile_not_found',
        'PROFILE_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!profile.stripeConnectAccountId) {
      throw new I18nHttpException(
        'stripe.no_account',
        'STRIPE_NO_ACCOUNT',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!profile.stripeOnboardingCompleted) {
      throw new I18nHttpException(
        'wallet.onboarding_required',
        'WALLET_ONBOARDING_REQUIRED',
        HttpStatus.BAD_REQUEST,
        undefined,
        { onboardingRequired: true },
      );
    }

    if (!profile.stripeIdentityVerified) {
      throw new I18nHttpException(
        'wallet.kyc_required',
        'WALLET_KYC_REQUIRED',
        HttpStatus.FORBIDDEN,
        undefined,
        { identityRequired: true },
      );
    }

    // 2. Créer Withdrawal PENDING + lock pessimiste sur le wallet (évite double-spend)
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      // SELECT … FOR UPDATE : verrou ligne wallet jusqu'à fin de transaction
      const locked = await tx.$queryRaw<
        { id: string; balance: string }[]
      >`SELECT id, balance FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE`;

      if (locked.length === 0) {
        throw new I18nHttpException(
          'wallet.not_found',
          'WALLET_NOT_FOUND',
          HttpStatus.NOT_FOUND,
        );
      }

      if (Number(locked[0].balance) < amount) {
        throw new I18nHttpException(
          'wallet.insufficient_balance',
          'WALLET_INSUFFICIENT_BALANCE',
          HttpStatus.BAD_REQUEST,
        );
      }

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
      this.notificationsService.tryQueueEmail({
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

      this.posthog.capture(userId, 'withdrawal_requested', {
        withdrawalId: withdrawal.id,
        amountEur: amount,
        stripePayoutId: payout.id,
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
      throw new I18nHttpException(
        'wallet.withdrawal_not_found',
        'WITHDRAWAL_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new I18nHttpException(
        'wallet.cannot_cancel',
        'WITHDRAWAL_CANNOT_CANCEL',
        HttpStatus.BAD_REQUEST,
      );
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
      throw new I18nHttpException(
        'wallet.withdrawal_not_found',
        'WITHDRAWAL_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    return withdrawal;
  }

  /**
   * Admin: Lister tous les retraits avec filtres et pagination
   */
  async listForAdmin(query: any) {
    const { page = 1, limit = 20, status, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
        { user: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [withdrawals, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.withdrawal.count({ where }),
    ]);

    const data = withdrawals.map((w) => ({
      id: w.id,
      amount: w.amount.toString(),
      method: w.method,
      status: w.status,
      createdAt: w.createdAt,
      processedAt: w.processedAt,
      user: w.user,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin: Rejeter une demande de retrait PENDING
   */
  async rejectByAdmin(
    withdrawalId: string,
    adminId: string,
    reason: string,
  ): Promise<any> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: { select: { id: true, email: true, firstName: true } } },
    });

    if (!withdrawal) {
      throw new I18nHttpException(
        'wallet.withdrawal_not_found',
        'WITHDRAWAL_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new I18nHttpException(
        'wallet.cannot_reject',
        'WITHDRAWAL_CANNOT_REJECT',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Rejeter et refund dans une transaction
    const rejected = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: WithdrawalStatus.FAILED,
          failureReason: `[ADMIN REJECT] ${reason}`,
          failedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
            },
          },
        },
      });

      // Refund au wallet
      await tx.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          balance: {
            increment: withdrawal.amount,
          },
        },
      });

      return updated;
    });

    // Audit
    await this.auditService.log(
      adminId,
      AuditCategory.WALLET,
      'WITHDRAWAL_REJECTED_BY_ADMIN',
      {
        withdrawalId,
        amount: Number(withdrawal.amount),
        reason,
      },
    );

    // Notification
    this.notificationsService.tryQueueEmail({
      to: withdrawal.user.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Withdrawal Request Declined',
      variables: {
        firstName: withdrawal.user.firstName || 'User',
        message: `Your withdrawal request has been declined. Reason: ${reason}. The amount has been refunded to your wallet.`,
      },
    });

    return rejected;
  }
}
