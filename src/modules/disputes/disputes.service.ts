import {
  Injectable,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';
import {
  SessionStatus,
  UserRole,
  AuditCategory,
  NotificationType,
  TransactionType,
  TransactionStatus,
} from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { Decimal } from '@prisma/client/runtime/library';
import { GamificationService } from '../gamification/gamification.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly walletService: WalletService,
    private readonly gamificationService: GamificationService,
    private readonly businessRulesService: BusinessRulesService,
  ) {}

  /**
   * Créer un litige (par testeur OU PRO)
   */
  async createDispute(
    sessionId: string,
    userId: string,
    dto: CreateDisputeDto,
  ): Promise<{
    session: any;
    createdBy: 'tester' | 'pro';
  }> {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: {
          include: {
            seller: true,
          },
        },
        tester: true,
      },
    });

    if (!session) {
      throw new I18nHttpException('dispute.session_not_found', 'DISPUTE_SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Vérifier que l'utilisateur est impliqué (testeur OU PRO)
    const isTester = session.testerId === userId;
    const isPro = session.campaign.sellerId === userId;

    if (!isTester && !isPro) {
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    // Vérifier que la session n'est pas déjà en litige
    if (session.status === SessionStatus.DISPUTED) {
      throw new I18nHttpException('dispute.invalid_status', 'DISPUTE_ALREADY_EXISTS', HttpStatus.BAD_REQUEST);
    }

    // Vérifier que la session est dans un état approprié pour litige
    const disputeableStatuses: SessionStatus[] = [
      SessionStatus.PURCHASE_SUBMITTED,
      SessionStatus.SUBMITTED,
      SessionStatus.PURCHASE_VALIDATED,
      SessionStatus.COMPLETED,
    ];

    if (!disputeableStatuses.includes(session.status)) {
      throw new I18nHttpException('dispute.invalid_status', 'DISPUTE_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `${isTester ? 'Tester' : 'PRO'} ${userId} creating dispute for session ${sessionId}`,
    );

    // Mettre à jour la session
    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.DISPUTED,
        disputeReason: dto.disputeReason,
        disputedAt: new Date(),
      },
      include: {
        campaign: {
          include: {
            seller: true,
          },
        },
        tester: true,
      },
    });

    // Notifier la partie adverse
    const otherParty = isTester ? session.campaign.seller : session.tester;
    const creatorName = isTester
      ? session.tester.firstName
      : session.campaign.seller.firstName;

    await this.notificationsService.queueEmail({
      to: otherParty.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Un litige a été créé',
      variables: {
        firstName: otherParty.firstName || 'Utilisateur',
        campaignTitle: session.campaign.title,
        creatorName,
        disputeReason: dto.disputeReason,
        message: `${isTester ? 'Le testeur' : 'Le professionnel'} ${creatorName} a créé un litige pour la session "${session.campaign.title}". Raison: ${dto.disputeReason}. Un administrateur examinera le dossier.`,
      },
      metadata: {
        sessionId,
        type: NotificationType.DISPUTE_CREATED,
      },
    });

    // Notifier tous les ADMIN
    const admins = await this.prisma.profile.findMany({
      where: { role: UserRole.ADMIN },
    });

    for (const admin of admins) {
      if (admin.email) {
        await this.notificationsService.queueEmail({
          to: admin.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Nouveau litige à examiner',
          variables: {
            firstName: admin.firstName || 'Admin',
            campaignTitle: session.campaign.title,
            creatorName,
            disputeReason: dto.disputeReason,
            message: `Un litige a été créé par ${isTester ? 'le testeur' : 'le PRO'} ${creatorName} pour la session "${session.campaign.title}". Raison: ${dto.disputeReason}`,
          },
          metadata: {
            sessionId,
            type: NotificationType.DISPUTE_CREATED,
          },
        });
      }
    }

    // Audit
    await this.auditService.log(
      userId,
      AuditCategory.SESSION,
      'DISPUTE_CREATED',
      {
        sessionId,
        reason: dto.disputeReason,
        createdBy: isTester ? 'tester' : 'pro',
        campaignId: session.campaignId,
      },
    );

    this.logger.log(`Dispute created for session ${sessionId} by ${isTester ? 'tester' : 'PRO'}`);

    return {
      session: updatedSession,
      createdBy: isTester ? 'tester' : 'pro',
    };
  }

  /**
   * Résoudre un litige (ADMIN uniquement)
   * L'admin fixe le montant accordé au testeur (0 à max).
   * Le reste (max - testerAmount) est automatiquement refundé au PRO.
   */
  async resolveDispute(
    sessionId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ): Promise<{
    session: any;
    testerTransfer?: any;
    proRefund?: any;
  }> {
    const admin = await this.prisma.profile.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: {
          include: {
            seller: true,
            offers: true,
          },
        },
        tester: true,
      },
    });

    if (!session) {
      throw new I18nHttpException('dispute.session_not_found', 'DISPUTE_SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (session.status !== SessionStatus.DISPUTED) {
      throw new I18nHttpException('dispute.invalid_status', 'DISPUTE_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    const offer = session.campaign.offers[0];
    if (!offer) {
      throw new I18nHttpException('common.not_found', 'OFFER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Calculer le montant maximum possible
    const rules = await this.businessRulesService.findLatest();
    const maxProductPrice = Number(offer.maxReimbursedPrice ?? offer.expectedPrice);
    const maxShippingCost = Number(offer.maxReimbursedShipping ?? offer.shippingCost);
    const testerBonus = rules.testerBonus;
    const proBonus = Number(offer.bonus ?? 0);
    const maxTotal = maxProductPrice + maxShippingCost + testerBonus + proBonus;

    // Valider le montant testeur
    if (dto.testerAmount < 0 || dto.testerAmount > maxTotal) {
      throw new I18nHttpException('dispute.invalid_status', 'DISPUTE_INVALID_AMOUNT', HttpStatus.BAD_REQUEST, { maxTotal });
    }

    const testerAmount = Math.round(dto.testerAmount * 100) / 100;
    const proRefundAmount = Math.round((maxTotal - testerAmount) * 100) / 100;

    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.logger.log(`⚖️ RESOLVING DISPUTE for session ${sessionId}`);
    this.logger.log(`   Max total: ${maxTotal}€`);
    this.logger.log(`   Tester receives: ${testerAmount}€`);
    this.logger.log(`   PRO refund: ${proRefundAmount}€`);
    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    let testerTransfer: any = null;
    let proRefund: any = null;

    const platformWallet = await this.prisma.platformWallet.findFirst();
    if (!platformWallet) {
      throw new I18nHttpException('common.not_found', 'PLATFORM_WALLET_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    let totalEscrowDecrement = 0;

    // 1. Transfer to tester if testerAmount > 0
    if (testerAmount > 0) {
      const testerStripeAccount = session.tester.stripeConnectAccountId;
      if (!testerStripeAccount) {
        throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.BAD_REQUEST);
      }

      // Ensure tester wallet exists
      await this.walletService.createWallet(session.testerId);

      testerTransfer = await this.stripeService.createPlatformToConnectTransfer(
        testerAmount,
        testerStripeAccount,
        'eur',
        {
          platform: 'supertry',
          transactionType: 'DISPUTE_RESOLUTION',
          sessionId,
          campaignId: session.campaignId,
          testerAmount: testerAmount.toFixed(2),
        },
        `Dispute resolution: ${session.campaign.title}`,
        `campaign_${session.campaignId}`,
      );

      const testerWallet = await this.prisma.wallet.findUnique({
        where: { userId: session.testerId },
      });

      await this.prisma.transaction.create({
        data: {
          walletId: testerWallet?.id || null,
          campaignId: session.campaignId,
          sessionId,
          type: TransactionType.DISPUTE_RESOLUTION,
          amount: new Decimal(testerAmount),
          reason: `Dispute resolution (tester): ${session.campaign.title}`,
          status: TransactionStatus.COMPLETED,
          stripeTransferId: testerTransfer.id,
          metadata: { recipient: 'tester', testerAmount },
        },
      });

      // Update tester wallet balance
      if (testerWallet) {
        await this.prisma.wallet.update({
          where: { id: testerWallet.id },
          data: {
            balance: { increment: new Decimal(testerAmount) },
            totalEarned: { increment: new Decimal(testerAmount) },
          },
        });
      }

      totalEscrowDecrement += testerAmount;
    }

    // 2. Refund to PRO if proRefundAmount > 0
    if (proRefundAmount > 0) {
      if (!session.campaign.stripePaymentIntentId) {
        throw new I18nHttpException('common.not_found', 'PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
      }

      proRefund = await this.stripeService.createRefund(
        session.campaign.stripePaymentIntentId,
        proRefundAmount,
        'requested_by_customer',
        {
          sessionId,
          campaignId: session.campaignId,
          transactionType: 'DISPUTE_REFUND_PRO',
          proRefundAmount: proRefundAmount.toFixed(2),
        },
      );

      await this.prisma.transaction.create({
        data: {
          walletId: null, // PLATEFORME
          campaignId: session.campaignId,
          sessionId,
          type: TransactionType.DISPUTE_RESOLUTION,
          amount: new Decimal(proRefundAmount),
          reason: `Dispute resolution (PRO refund): ${session.campaign.title}`,
          status: TransactionStatus.COMPLETED,
          stripeRefundId: proRefund.id,
          metadata: { recipient: 'pro', proRefundAmount },
        },
      });

      totalEscrowDecrement += proRefundAmount;
    }

    // 3. Update PlatformWallet
    if (totalEscrowDecrement > 0) {
      await this.prisma.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: {
            decrement: new Decimal(totalEscrowDecrement),
          },
          ...(testerAmount > 0 && {
            totalTransferred: { increment: new Decimal(testerAmount) },
          }),
        },
      });
    }

    // 4. Update session status
    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.COMPLETED,
        disputeResolution: dto.disputeResolution,
        disputeResolvedAt: new Date(),
      },
      include: {
        campaign: { include: { seller: true } },
        tester: true,
      },
    });

    // 5. Notify tester & PRO
    const testerMessage = testerAmount > 0
      ? `Vous recevez ${testerAmount}€.`
      : `Aucun montant ne vous a été accordé.`;

    const proMessage = proRefundAmount > 0
      ? `Vous êtes remboursé de ${proRefundAmount}€.`
      : `Aucun remboursement ne vous a été accordé.`;

    await this.notificationsService.queueEmail({
      to: session.tester.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Litige résolu',
      variables: {
        firstName: session.tester.firstName || 'Testeur',
        campaignTitle: session.campaign.title,
        message: `Le litige concernant "${session.campaign.title}" a été résolu. ${testerMessage} Décision: ${dto.disputeResolution}`,
      },
      metadata: {
        sessionId,
        type: NotificationType.DISPUTE_CREATED,
      },
    });

    await this.notificationsService.queueEmail({
      to: session.campaign.seller.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Litige résolu',
      variables: {
        firstName: session.campaign.seller.firstName || 'Pro',
        campaignTitle: session.campaign.title,
        message: `Le litige concernant "${session.campaign.title}" a été résolu. ${proMessage} Décision: ${dto.disputeResolution}`,
      },
      metadata: {
        sessionId,
        type: NotificationType.DISPUTE_CREATED,
      },
    });

    // 6. Audit
    await this.auditService.log(
      adminId,
      AuditCategory.SESSION,
      'DISPUTE_RESOLVED',
      {
        sessionId,
        campaignId: session.campaignId,
        resolution: dto.disputeResolution,
        testerAmount,
        proRefundAmount,
        maxTotal,
      },
    );

    this.logger.log(`Dispute resolved for session ${sessionId} by admin ${adminId}`);

    // 7. Gamification: reverse XP if tester gets nothing (non-blocking)
    if (testerAmount === 0) {
      try {
        await this.gamificationService.reverseSessionXp(session.testerId, sessionId);
      } catch (error) {
        this.logger.error(`Gamification XP reversal failed: ${error.message}`);
      }
    }

    return {
      session: updatedSession,
      testerTransfer,
      proRefund,
    };
  }

  /**
   * Obtenir les détails d'un litige
   */
  async getDisputeDetails(sessionId: string, userId: string): Promise<any> {
    const user = await this.prisma.profile.findUnique({
      where: { id: userId },
    });

    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: {
          include: {
            seller: true,
          },
        },
        tester: true,
      },
    });

    if (!session) {
      throw new I18nHttpException('dispute.session_not_found', 'DISPUTE_SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Vérifier les permissions
    const isTester = session.testerId === userId;
    const isPro = session.campaign.sellerId === userId;
    const isAdmin = user!.role === UserRole.ADMIN;

    if (!isTester && !isPro && !isAdmin) {
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    return {
      session,
      disputeReason: session.disputeReason,
      disputedAt: session.disputedAt,
      disputeResolution: session.disputeResolution,
      disputeResolvedAt: session.disputeResolvedAt,
      status: session.status,
    };
  }

  /**
   * Liste des litiges (ADMIN uniquement)
   */
  async getDisputesByStatus(status?: string): Promise<any[]> {
    const where: any = {
      status: status || SessionStatus.DISPUTED,
    };

    const sessions = await this.prisma.testSession.findMany({
      where,
      include: {
        campaign: {
          include: {
            seller: true,
          },
        },
        tester: true,
      },
      orderBy: {
        disputedAt: 'desc',
      },
    });

    return sessions;
  }
}
