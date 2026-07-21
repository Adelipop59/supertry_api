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
  NotificationChannel,
  DisputeVisibility,
  TransactionType,
  TransactionStatus,
} from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto, DisputeResolutionMode } from './dto/resolve-dispute.dto';
import { CreateDisputeMessageDto } from './dto/create-dispute-message.dto';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { Decimal } from '@prisma/client/runtime/library';
import { GamificationService } from '../gamification/gamification.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { PostHogService } from '../posthog/posthog.service';
import { MessagesGateway } from '../messages/messages.gateway';
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
    private readonly posthog: PostHogService,
    private readonly messagesGateway: MessagesGateway,
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

    this.notificationsService.tryQueueEmail({
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
        this.notificationsService.tryQueueEmail({
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

    this.posthog.capture(userId, 'dispute_filed', {
      sessionId,
      campaignId: session.campaignId,
      createdBy: isTester ? 'tester' : 'pro',
      reason: dto.disputeReason,
    });

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

    // Modèle binaire (SEC-P1.7) : le MONTANT est calculé côté serveur à partir du sens
    // de résolution, jamais fourni par le client.
    //  - REFUND_TESTER → le testeur reçoit le montant max, rien au PRO.
    //  - REFUND_PRO    → le PRO est intégralement remboursé, rien au testeur.
    const testerAmount =
      dto.resolution === DisputeResolutionMode.REFUND_TESTER
        ? Math.round(maxTotal * 100) / 100
        : 0;
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

    // SÉCURITÉ (SEC-P1.7) — Idempotence : ne pas résoudre deux fois le même litige.
    const existingResolution = await this.prisma.transaction.findFirst({
      where: { sessionId, type: TransactionType.DISPUTE_RESOLUTION },
    });
    if (existingResolution) {
      this.logger.warn(`Dispute already resolved for session ${sessionId} — ignoré (idempotent).`);
      throw new I18nHttpException('dispute.invalid_status', 'DISPUTE_ALREADY_RESOLVED', HttpStatus.BAD_REQUEST);
    }

    // Pré-requis Stripe validés AVANT tout appel (fail-fast, évite un état à moitié fait).
    let testerStripeAccount: string | null = null;
    if (testerAmount > 0) {
      testerStripeAccount = session.tester.stripeConnectAccountId;
      if (!testerStripeAccount) {
        throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.BAD_REQUEST);
      }
      await this.walletService.createWallet(session.testerId);
    }
    if (proRefundAmount > 0 && !session.campaign.stripePaymentIntentId) {
      throw new I18nHttpException('common.not_found', 'PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    let totalEscrowDecrement = 0;

    // ══════════════════════════════════════════════════════════════════════════
    // SÉCURITÉ (SEC-P1.7) — PHASE 1 : appels Stripe (non transactionnels).
    // Auparavant, transferts/refunds et écritures DB étaient entrelacés sans
    // `$transaction` : une panne au milieu laissait l'escrow incohérent (session
    // toujours DISPUTED, wallet crédité mais escrow non décrémenté, etc.). On isole
    // désormais les appels Stripe (idempotents), PUIS on persiste tout en une seule
    // transaction (PHASE 2).
    // ══════════════════════════════════════════════════════════════════════════

    // 1. Transfert au testeur (clé d'idempotence dérivée du sessionId côté service)
    if (testerAmount > 0) {
      testerTransfer = await this.stripeService.createPlatformToConnectTransfer(
        testerAmount,
        testerStripeAccount!,
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
      totalEscrowDecrement += testerAmount;
    }

    // 2. Remboursement au PRO (clé d'idempotence explicite → pas de double refund)
    if (proRefundAmount > 0) {
      proRefund = await this.stripeService.createRefund(
        session.campaign.stripePaymentIntentId!,
        proRefundAmount,
        'requested_by_customer',
        {
          sessionId,
          campaignId: session.campaignId,
          transactionType: 'DISPUTE_REFUND_PRO',
          proRefundAmount: proRefundAmount.toFixed(2),
        },
        `dispute-refund-${sessionId}`,
      );
      totalEscrowDecrement += proRefundAmount;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 2 : toutes les écritures DB dans UNE SEULE $transaction.
    // ══════════════════════════════════════════════════════════════════════════
    const updatedSession = await this.prisma.$transaction(async (tx) => {
      if (testerAmount > 0) {
        const testerWallet = await tx.wallet.findUnique({
          where: { userId: session.testerId },
        });

        await tx.transaction.create({
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

        if (testerWallet) {
          await tx.wallet.update({
            where: { id: testerWallet.id },
            data: {
              balance: { increment: new Decimal(testerAmount) },
              totalEarned: { increment: new Decimal(testerAmount) },
            },
          });
        }
      }

      if (proRefundAmount > 0) {
        await tx.transaction.create({
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
      }

      if (totalEscrowDecrement > 0) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { decrement: new Decimal(totalEscrowDecrement) },
            ...(testerAmount > 0 && {
              totalTransferred: { increment: new Decimal(testerAmount) },
            }),
          },
        });
      }

      return tx.testSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.COMPLETED,
          disputeResolution: dto.reason,
          disputeResolvedAt: new Date(),
        },
        include: {
          campaign: { include: { seller: true } },
          tester: true,
        },
      });
    });

    // 5. Notify tester & PRO
    const testerMessage = testerAmount > 0
      ? `Vous recevez ${testerAmount}€.`
      : `Aucun montant ne vous a été accordé.`;

    const proMessage = proRefundAmount > 0
      ? `Vous êtes remboursé de ${proRefundAmount}€.`
      : `Aucun remboursement ne vous a été accordé.`;

    this.notificationsService.tryQueueEmail({
      to: session.tester.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Litige résolu',
      variables: {
        firstName: session.tester.firstName || 'Testeur',
        campaignTitle: session.campaign.title,
        message: `Le litige concernant "${session.campaign.title}" a été résolu. ${testerMessage} Motif: ${dto.reason}`,
      },
      metadata: {
        sessionId,
        type: NotificationType.DISPUTE_CREATED,
      },
    });

    this.notificationsService.tryQueueEmail({
      to: session.campaign.seller.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Litige résolu',
      variables: {
        firstName: session.campaign.seller.firstName || 'Pro',
        campaignTitle: session.campaign.title,
        message: `Le litige concernant "${session.campaign.title}" a été résolu. ${proMessage} Motif: ${dto.reason}`,
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
        resolution: dto.resolution,
        reason: dto.reason,
        testerAmount,
        proRefundAmount,
        maxTotal,
      },
    );

    this.logger.log(`Dispute resolved for session ${sessionId} by admin ${adminId}`);

    this.posthog.capture(session.testerId, 'dispute_resolved', {
      sessionId,
      campaignId: session.campaignId,
      sellerId: session.campaign.seller.id,
      resolution: dto.resolution,
      testerAmount,
      proRefundAmount,
      resolvedBy: adminId,
    });

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

  // ════════════════════════════════════════════════════════════════════════════
  // MESSAGERIE DE LITIGE À 3 PARTIES (marque ↔ testeur ↔ SuperTry)
  // La visibilité de chaque message est TOUJOURS vérifiée côté serveur : le front
  // ne peut jamais lire un message hors de sa visibilité (SEC : pas de filtrage
  // côté client). USER/PRO écrivent uniquement en BOTH ; seul l'ADMIN peut
  // adresser un message à une seule partie (BRAND_ONLY / TESTER_ONLY).
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Résout le rôle de l'appelant vis-à-vis de la session + garde d'accès.
   * L'appelant doit être le testeur, le vendeur (PRO) de la campagne, ou un ADMIN.
   * La session doit être en litige (DISPUTED).
   */
  private async resolveDisputeParticipant(sessionId: string, userId: string) {
    const user = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: { include: { seller: true } },
        tester: true,
      },
    });

    if (!session) {
      throw new I18nHttpException(
        'dispute.session_not_found',
        'DISPUTE_SESSION_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    const isTester = session.testerId === userId;
    const isPro = session.campaign.sellerId === userId;

    if (!isAdmin && !isTester && !isPro) {
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    if (session.status !== SessionStatus.DISPUTED) {
      throw new I18nHttpException(
        'dispute.invalid_status',
        'DISPUTE_NOT_ACTIVE',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Rôle métier de l'appelant (source de vérité serveur).
    const role: UserRole = isAdmin
      ? UserRole.ADMIN
      : isPro
        ? UserRole.PRO
        : UserRole.USER;

    return { session, role, isAdmin, isTester, isPro };
  }

  /** Statuts de visibilité qu'un rôle donné est autorisé à lire. */
  private visibilitiesForRole(role: UserRole): DisputeVisibility[] {
    if (role === UserRole.ADMIN) {
      return [
        DisputeVisibility.BOTH,
        DisputeVisibility.BRAND_ONLY,
        DisputeVisibility.TESTER_ONLY,
      ];
    }
    if (role === UserRole.PRO) {
      return [DisputeVisibility.BOTH, DisputeVisibility.BRAND_ONLY];
    }
    // USER (testeur)
    return [DisputeVisibility.BOTH, DisputeVisibility.TESTER_ONLY];
  }

  /** Nom d'affichage d'un expéditeur selon son rôle. */
  private senderDisplayName(sender: {
    // Profile.role is nullable (unset during OAuth onboarding), so accept null.
    role: UserRole | null;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  }): string {
    if (sender.role === UserRole.ADMIN) return 'SuperTry';
    if (sender.role === UserRole.PRO && sender.companyName) {
      return sender.companyName;
    }
    const first = sender.firstName ?? '';
    const initial = sender.lastName ? `${sender.lastName.charAt(0)}.` : '';
    return `${first} ${initial}`.trim() || 'Utilisateur';
  }

  /**
   * GET disputes/sessions/:id/messages
   * Liste des messages du litige, filtrée par la visibilité autorisée au rôle
   * de l'appelant (vérification CÔTÉ SERVEUR).
   */
  async getDisputeMessages(sessionId: string, userId: string): Promise<any[]> {
    const { role } = await this.resolveDisputeParticipant(sessionId, userId);

    const allowed = this.visibilitiesForRole(role);

    const messages = await this.prisma.disputeMessage.findMany({
      where: { sessionId, visibility: { in: allowed } },
      include: {
        sender: {
          select: {
            id: true,
            role: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      senderId: m.senderId,
      senderRole: m.senderRole,
      senderName: this.senderDisplayName(m.sender),
      content: m.content,
      attachments: m.attachments ?? null,
      visibility: m.visibility,
      createdAt: m.createdAt,
      isMine: m.senderId === userId,
    }));
  }

  /**
   * POST disputes/sessions/:id/messages
   * USER/PRO : visibilité FORCÉE à BOTH. ADMIN : visibilité = dto.visibility ?? BOTH.
   * Persiste, émet le socket `new_dispute_message` aux destinataires autorisés
   * (respect de la visibilité) et crée une notification pour chaque partie
   * autorisée sauf l'expéditeur.
   */
  async createDisputeMessage(
    sessionId: string,
    userId: string,
    dto: CreateDisputeMessageDto,
  ): Promise<any> {
    const { session, role } = await this.resolveDisputeParticipant(sessionId, userId);

    // La visibilité n'est jamais décidée par le client (sauf ADMIN).
    const visibility: DisputeVisibility =
      role === UserRole.ADMIN
        ? (dto.visibility ?? DisputeVisibility.BOTH)
        : DisputeVisibility.BOTH;

    const created = await this.prisma.disputeMessage.create({
      data: {
        sessionId,
        senderId: userId,
        senderRole: role,
        content: dto.content,
        attachments: dto.attachments ?? undefined,
        visibility,
      },
      include: {
        sender: {
          select: {
            id: true,
            role: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
      },
    });

    const senderName = this.senderDisplayName(created.sender);

    const buildPayload = (viewerId: string) => ({
      id: created.id,
      sessionId: created.sessionId,
      senderId: created.senderId,
      senderRole: created.senderRole,
      senderName,
      content: created.content,
      attachments: created.attachments ?? null,
      visibility: created.visibility,
      createdAt: created.createdAt,
      isMine: created.senderId === viewerId,
    });

    // Ensemble des utilisateurs AUTORISÉS à voir ce message selon la visibilité.
    const admins = await this.prisma.profile.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });

    const authorizedIds = new Set<string>();
    // La marque (vendeur) : visible en BOTH ou BRAND_ONLY.
    if (
      visibility === DisputeVisibility.BOTH ||
      visibility === DisputeVisibility.BRAND_ONLY
    ) {
      authorizedIds.add(session.campaign.sellerId);
    }
    // Le testeur : visible en BOTH ou TESTER_ONLY.
    if (
      visibility === DisputeVisibility.BOTH ||
      visibility === DisputeVisibility.TESTER_ONLY
    ) {
      authorizedIds.add(session.testerId);
    }
    // SuperTry (admins) : voit toujours tout.
    for (const a of admins) authorizedIds.add(a.id);

    // Émission socket vers les rooms personnelles des destinataires autorisés
    // (l'expéditeur inclus, pour synchro multi-appareils).
    for (const viewerId of authorizedIds) {
      this.messagesGateway.emitToUser(
        viewerId,
        'new_dispute_message',
        buildPayload(viewerId),
      );
    }

    // La room partagée `dispute:{sessionId}` ne reçoit le message QUE s'il est
    // visible par tout le monde (BOTH). Pour un message restreint, on ne diffuse
    // JAMAIS dans la room commune (un participant non autorisé pourrait l'y lire).
    if (visibility === DisputeVisibility.BOTH) {
      this.messagesGateway.emitToDispute(
        sessionId,
        'new_dispute_message',
        buildPayload(''),
      );
    }

    // Notifications in-app pour chaque partie autorisée, sauf l'expéditeur.
    for (const viewerId of authorizedIds) {
      if (viewerId === userId) continue;
      try {
        await this.prisma.notification.create({
          data: {
            userId: viewerId,
            type: NotificationType.DISPUTE_MESSAGE,
            channel: NotificationChannel.IN_APP,
            title: 'Nouveau message dans un litige',
            message: `${senderName} : ${created.content.slice(0, 140)}`,
            data: { sessionId, disputeMessageId: created.id },
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to create dispute message notification for ${viewerId}: ${error.message}`,
        );
      }
    }

    this.posthog.capture(userId, 'dispute_message_sent', {
      sessionId,
      campaignId: session.campaignId,
      senderRole: role,
      visibility,
    });

    return buildPayload(userId);
  }
}
