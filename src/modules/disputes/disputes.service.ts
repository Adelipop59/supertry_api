import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SessionStatus,
  UserRole,
  AuditCategory,
  NotificationType,
  TransactionType,
  TransactionStatus,
} from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto, DisputeResolutionType } from './dto/resolve-dispute.dto';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
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
      throw new NotFoundException('Session not found');
    }

    // Vérifier que l'utilisateur est impliqué (testeur OU PRO)
    const isTester = session.testerId === userId;
    const isPro = session.campaign.sellerId === userId;

    if (!isTester && !isPro) {
      throw new ForbiddenException('You are not involved in this session');
    }

    // Vérifier que la session n'est pas déjà en litige
    if (session.status === SessionStatus.DISPUTED) {
      throw new BadRequestException('This session is already in dispute');
    }

    // Vérifier que la session est dans un état approprié pour litige
    const disputeableStatuses: SessionStatus[] = [
      SessionStatus.SUBMITTED,
      SessionStatus.PURCHASE_VALIDATED,
      SessionStatus.COMPLETED,
    ];

    if (!disputeableStatuses.includes(session.status)) {
      throw new BadRequestException(
        `Cannot create dispute for session in ${session.status} status`,
      );
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
   */
  async resolveDispute(
    sessionId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ): Promise<{
    session: any;
    refund?: any;
    transfer?: any;
  }> {
    const admin = await this.prisma.profile.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can resolve disputes');
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
      throw new NotFoundException('Session not found');
    }

    if (session.status !== SessionStatus.DISPUTED) {
      throw new BadRequestException('Session is not in disputed status');
    }

    this.logger.log(
      `Admin ${adminId} resolving dispute for session ${sessionId} (type: ${dto.resolutionType})`,
    );

    let refund: any = null;
    let transfer: any = null;

    // Récupérer le PlatformWallet
    const platformWallet = await this.prisma.platformWallet.findFirst();

    // Traiter selon le type de résolution
    switch (dto.resolutionType) {
      case DisputeResolutionType.REFUND_TESTER:
        // Rembourser le testeur (produit + shipping + bonus)
        if (!session.campaign.stripePaymentIntentId) {
          throw new BadRequestException('No payment found for refund');
        }

        const productCost = Number(
          session.validatedProductPrice || session.campaign.offers[0].expectedPrice,
        );
        const shippingCost = Number(session.campaign.offers[0].shippingCost);
        const testerBonus = Number(session.campaign.offers[0].bonus);
        const refundAmount = productCost + shippingCost + testerBonus;

        refund = await this.stripeService.createRefund(
          session.campaign.stripePaymentIntentId,
          refundAmount,
          'requested_by_customer',
          {
            sessionId,
            resolutionType: dto.resolutionType,
            transactionType: 'DISPUTE_REFUND_TESTER',
          },
        );

        // Trouver le wallet du testeur
        const testerWallet = await this.prisma.wallet.findUnique({
          where: { userId: session.testerId },
        });

        await this.prisma.transaction.create({
          data: {
            walletId: testerWallet?.id || null,
            campaignId: session.campaignId,
            sessionId,
            type: TransactionType.DISPUTE_RESOLUTION,
            amount: new Decimal(refundAmount),
            reason: `Dispute resolution refund: ${session.campaign.title}`,
            status: TransactionStatus.COMPLETED,
            stripeRefundId: refund.id,
          },
        });

        if (platformWallet) {
          await this.prisma.platformWallet.update({
            where: { id: platformWallet.id },
            data: {
              escrowBalance: {
                decrement: new Decimal(refundAmount),
              },
            },
          });
        }
        break;

      case DisputeResolutionType.REFUND_PRO:
        // Rembourser le PRO
        if (!session.campaign.stripePaymentIntentId) {
          throw new BadRequestException('No payment found for refund');
        }

        const proRefundAmount = dto.refundAmount || 0;

        if (proRefundAmount > 0) {
          refund = await this.stripeService.createRefund(
            session.campaign.stripePaymentIntentId,
            proRefundAmount,
            'requested_by_customer',
            {
              sessionId,
              resolutionType: dto.resolutionType,
              transactionType: 'DISPUTE_REFUND_PRO',
            },
          );

          // Trouver le wallet du seller
          const sellerWallet = await this.prisma.wallet.findUnique({
            where: { userId: session.campaign.sellerId },
          });

          await this.prisma.transaction.create({
            data: {
              walletId: sellerWallet?.id || null,
              campaignId: session.campaignId,
              sessionId,
              type: TransactionType.DISPUTE_RESOLUTION,
              amount: new Decimal(proRefundAmount),
              reason: `Dispute resolution refund to PRO: ${session.campaign.title}`,
              status: TransactionStatus.COMPLETED,
              stripeRefundId: refund.id,
            },
          });

          if (platformWallet) {
            await this.prisma.platformWallet.update({
              where: { id: platformWallet.id },
              data: {
                escrowBalance: {
                  decrement: new Decimal(proRefundAmount),
                },
              },
            });
          }
        }
        break;

      case DisputeResolutionType.PARTIAL_REFUND:
        // Remboursement partiel (spécifier le montant)
        if (!dto.refundAmount || dto.refundAmount <= 0) {
          throw new BadRequestException('Refund amount required for partial refund');
        }

        if (!session.campaign.stripePaymentIntentId) {
          throw new BadRequestException('No payment found for refund');
        }

        refund = await this.stripeService.createRefund(
          session.campaign.stripePaymentIntentId,
          dto.refundAmount,
          'requested_by_customer',
          {
            sessionId,
            resolutionType: dto.resolutionType,
            transactionType: 'DISPUTE_PARTIAL_REFUND',
          },
        );

        // Trouver le wallet du seller pour partial refund
        const partialSellerWallet = await this.prisma.wallet.findUnique({
          where: { userId: session.campaign.sellerId },
        });

        await this.prisma.transaction.create({
          data: {
            walletId: partialSellerWallet?.id || null,
            campaignId: session.campaignId,
            sessionId,
            type: TransactionType.DISPUTE_RESOLUTION,
            amount: new Decimal(dto.refundAmount),
            reason: `Dispute partial refund: ${session.campaign.title}`,
            status: TransactionStatus.COMPLETED,
            stripeRefundId: refund.id,
          },
        });

        if (platformWallet) {
          await this.prisma.platformWallet.update({
            where: { id: platformWallet.id },
            data: {
              escrowBalance: {
                decrement: new Decimal(dto.refundAmount),
              },
            },
          });
        }
        break;

      case DisputeResolutionType.NO_REFUND:
        // Pas de remboursement, simplement clôturer le litige
        break;
    }

    // Mettre à jour la session
    const updatedSession = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.COMPLETED, // Retour à COMPLETED après résolution
        disputeResolution: dto.disputeResolution,
        disputeResolvedAt: new Date(),
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

    // Notifier testeur et PRO
    await this.notificationsService.queueEmail({
      to: session.tester.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Litige résolu',
      variables: {
        firstName: session.tester.firstName || 'Testeur',
        campaignTitle: session.campaign.title,
        resolution: dto.disputeResolution,
        message: `Le litige concernant "${session.campaign.title}" a été résolu. Décision: ${dto.disputeResolution}`,
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
        resolution: dto.disputeResolution,
        message: `Le litige concernant "${session.campaign.title}" a été résolu. Décision: ${dto.disputeResolution}`,
      },
      metadata: {
        sessionId,
        type: NotificationType.DISPUTE_CREATED,
      },
    });

    // Audit
    await this.auditService.log(
      adminId,
      AuditCategory.SESSION,
      'DISPUTE_RESOLVED',
      {
        sessionId,
        resolution: dto.disputeResolution,
        resolutionType: dto.resolutionType,
        refundAmount: dto.refundAmount,
        campaignId: session.campaignId,
      },
    );

    this.logger.log(`Dispute resolved for session ${sessionId} by admin ${adminId}`);

    return {
      session: updatedSession,
      refund,
      transfer,
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
      throw new NotFoundException('Session not found');
    }

    // Vérifier les permissions
    const isTester = session.testerId === userId;
    const isPro = session.campaign.sellerId === userId;
    const isAdmin = user!.role === UserRole.ADMIN;

    if (!isTester && !isPro && !isAdmin) {
      throw new ForbiddenException('You do not have access to this dispute');
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
