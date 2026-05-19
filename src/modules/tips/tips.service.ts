import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import {
  Prisma,
  SessionStatus,
  TransactionType,
  TransactionStatus,
  AuditCategory,
  NotificationType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { AuditService } from '../audit/audit.service';
import {
  createPaginatedResponse,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
import { CreateTipDto } from './dto/create-tip.dto';
import { TipFilterDto } from './dto/tip-filter.dto';

const TIP_INCLUDE = {
  session: {
    include: {
      campaign: { select: { id: true, title: true, sellerId: true } },
      tester: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          stripeConnectAccountId: true,
        },
      },
    },
  },
  giver: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  receiver: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      stripeConnectAccountId: true,
    },
  },
};

const TIP_INELIGIBLE_SESSION_STATUSES: SessionStatus[] = [
  SessionStatus.PENDING,
  SessionStatus.REJECTED,
  SessionStatus.CANCELLED,
  SessionStatus.DISPUTED,
];

@Injectable()
export class TipsService {
  private readonly logger = new Logger(TipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  // ============================================================================
  // CREATE TIP (PRO → TESTEUR), paiement immédiat
  // ============================================================================

  async createTip(userId: string, dto: CreateTipDto) {
    // 1. Feature flag
    if (!(await this.businessRulesService.areTipsEnabled())) {
      throw new I18nHttpException(
        'common.feature_disabled',
        'TIPS_DISABLED',
        HttpStatus.FORBIDDEN,
      );
    }

    // 2. Charger la session avec campagne + testeur
    const session = await this.prisma.testSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        campaign: { select: { id: true, title: true, sellerId: true } },
        tester: {
          select: {
            id: true,
            firstName: true,
            email: true,
            stripeConnectAccountId: true,
          },
        },
      },
    });

    if (!session) {
      throw new I18nHttpException(
        'dispute.session_not_found',
        'SESSION_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    // 3. PRO doit être propriétaire de la campagne
    if (session.campaign.sellerId !== userId) {
      throw new I18nHttpException(
        'ugc.not_owner',
        'TIP_NOT_OWNER',
        HttpStatus.FORBIDDEN,
      );
    }

    // 4. Statut session éligible
    if (TIP_INELIGIBLE_SESSION_STATUSES.includes(session.status)) {
      throw new I18nHttpException(
        'ugc.invalid_status',
        'TIP_INVALID_STATUS',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 5. Le testeur doit avoir un compte Stripe Connect actif
    if (!session.tester.stripeConnectAccountId) {
      throw new I18nHttpException(
        'stripe.no_account',
        'TIP_TESTER_NOT_PAYABLE',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 6. Calculer commission SuperTry
    const commissionPercent =
      await this.businessRulesService.getTipCommissionPercent();
    const amount = new Decimal(dto.amount);
    const commission = amount
      .mul(new Decimal(commissionPercent))
      .div(100)
      .toDecimalPlaces(2);
    const totalCharge = amount.plus(commission);

    // 7. Stripe PaymentIntent (capture automatique, paiement immédiat)
    const paymentIntent = await this.stripeService.createPaymentIntent(
      totalCharge.toNumber(),
      'eur',
      {
        platform: 'supertry',
        transactionType: 'TIP',
        sessionId: dto.sessionId,
        campaignId: session.campaign.id,
        proId: userId,
        testerId: session.tester.id,
      },
      { captureMethod: 'automatic' },
    );

    await this.stripeService.confirmPaymentIntent(
      paymentIntent.id,
      dto.paymentMethodId,
    );

    // 8. Transfer immédiat vers le compte Connect du testeur (montant net, sans commission)
    const transfer = await this.stripeService.createPlatformToConnectTransfer(
      amount.toNumber(),
      session.tester.stripeConnectAccountId,
      'eur',
      {
        platform: 'supertry',
        transactionType: 'TIP',
        sessionId: dto.sessionId,
        campaignId: session.campaign.id,
      },
    );

    // 9. Persister Tip + Transactions + Wallet/PlatformWallet en atomique
    const tip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tip.create({
        data: {
          sessionId: dto.sessionId,
          giverId: userId,
          receiverId: session.tester.id,
          amount,
          commission,
          message: dto.message ?? null,
        },
        include: TIP_INCLUDE,
      });

      // Wallet testeur (créer si manquant)
      let testerWallet = await tx.wallet.findUnique({
        where: { userId: session.tester.id },
      });
      if (!testerWallet) {
        testerWallet = await tx.wallet.create({
          data: {
            userId: session.tester.id,
            balance: 0,
            pendingBalance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
          },
        });
      }

      await tx.transaction.create({
        data: {
          walletId: testerWallet.id,
          type: TransactionType.TIP,
          amount,
          reason: `Tip de ${userId}`,
          tipId: created.id,
          sessionId: dto.sessionId,
          campaignId: session.campaign.id,
          stripePaymentIntentId: paymentIntent.id,
          stripeTransferId: transfer.id,
          status: TransactionStatus.COMPLETED,
        },
      });

      await tx.transaction.create({
        data: {
          walletId: null,
          type: TransactionType.TIP_COMMISSION,
          amount: commission,
          reason: 'Commission SuperTry sur tip',
          tipId: created.id,
          sessionId: dto.sessionId,
          campaignId: session.campaign.id,
          status: TransactionStatus.COMPLETED,
        },
      });

      await tx.wallet.update({
        where: { id: testerWallet.id },
        data: {
          balance: { increment: amount },
          totalEarned: { increment: amount },
          lastCreditedAt: new Date(),
        },
      });

      const platformWallet = await tx.platformWallet.findFirst();
      if (platformWallet) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            commissionBalance: { increment: commission },
            totalReceived: { increment: totalCharge },
            totalTransferred: { increment: amount },
            totalCommissions: { increment: commission },
          },
        });
      }

      return created;
    });

    // 10. Notifier le testeur
    if (session.tester.email) {
      this.notificationsService.tryQueueEmail({
        to: session.tester.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Vous avez reçu un tip !',
        variables: {
          firstName: session.tester.firstName || 'Testeur',
          campaignTitle: session.campaign.title,
          amount: `${amount.toFixed(2)}€`,
          message:
            dto.message ??
            `Le PRO vous a envoyé un tip de ${amount.toFixed(2)}€ pour la campagne « ${session.campaign.title} ».`,
        },
        metadata: {
          tipId: tip.id,
          sessionId: dto.sessionId,
          type: NotificationType.TIP_RECEIVED,
        },
      });
    }

    // 11. Audit
    await this.auditService.log(userId, AuditCategory.WALLET, 'TIP_SENT', {
      tipId: tip.id,
      sessionId: dto.sessionId,
      campaignId: session.campaign.id,
      receiverId: session.tester.id,
      amount: amount.toNumber(),
      commission: commission.toNumber(),
      stripePaymentIntentId: paymentIntent.id,
      stripeTransferId: transfer.id,
    });

    this.logger.log(
      `Tip sent: ${tip.id} — ${amount.toFixed(2)}€ from ${userId} to ${session.tester.id} (session ${dto.sessionId})`,
    );
    return tip;
  }

  // ============================================================================
  // LIST ENDPOINTS
  // ============================================================================

  async listSent(
    userId: string,
    filterDto: TipFilterDto,
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10, sessionId } = filterDto;
    const skip = (page - 1) * limit;

    const where: Prisma.TipWhereInput = { giverId: userId };
    if (sessionId) where.sessionId = sessionId;

    const [tips, total] = await Promise.all([
      this.prisma.tip.findMany({
        where,
        skip,
        take: limit,
        include: TIP_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tip.count({ where }),
    ]);

    return createPaginatedResponse(tips, total, page, limit);
  }

  async listReceived(
    userId: string,
    filterDto: TipFilterDto,
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10, sessionId } = filterDto;
    const skip = (page - 1) * limit;

    const where: Prisma.TipWhereInput = { receiverId: userId };
    if (sessionId) where.sessionId = sessionId;

    const [tips, total] = await Promise.all([
      this.prisma.tip.findMany({
        where,
        skip,
        take: limit,
        include: TIP_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tip.count({ where }),
    ]);

    return createPaginatedResponse(tips, total, page, limit);
  }
}
