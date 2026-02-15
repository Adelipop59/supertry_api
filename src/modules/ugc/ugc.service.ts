import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  UGCStatus,
  UGCType,
  SessionStatus,
  TransactionType,
  TransactionStatus,
  AuditCategory,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { MediaService, MediaFolder, MediaType } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { AuditService } from '../audit/audit.service';
import { createPaginatedResponse, PaginatedResponse } from '../../common/dto/pagination.dto';
import { CreateUgcRequestDto } from './dto/create-ugc-request.dto';
import { SubmitUgcDto } from './dto/submit-ugc.dto';
import { ValidateUgcDto } from './dto/validate-ugc.dto';
import { RejectUgcDto } from './dto/reject-ugc.dto';
import { DeclineUgcDto } from './dto/decline-ugc.dto';
import { CancelUgcDto } from './dto/cancel-ugc.dto';
import { ResolveUgcDisputeDto, UgcDisputeResolutionType } from './dto/resolve-ugc-dispute.dto';
import { UgcFilterDto } from './dto/ugc-filter.dto';

const UGC_INCLUDE = {
  session: {
    include: {
      campaign: { select: { id: true, title: true, sellerId: true } },
      tester: { select: { id: true, firstName: true, lastName: true, email: true, stripeConnectAccountId: true } },
    },
  },
  requester: { select: { id: true, firstName: true, lastName: true, email: true } },
  submitter: { select: { id: true, firstName: true, lastName: true, email: true, stripeConnectAccountId: true } },
};

@Injectable()
export class UgcService {
  private readonly logger = new Logger(UgcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly mediaService: MediaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  // ============================================================================
  // REQUEST UGC (PRO)
  // ============================================================================

  async requestUgc(userId: string, dto: CreateUgcRequestDto) {
    // 1. Vérifier la session
    const session = await this.prisma.testSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        campaign: { select: { id: true, title: true, sellerId: true } },
        tester: { select: { id: true, firstName: true, email: true, stripeConnectAccountId: true } },
      },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.campaign.sellerId !== userId) {
      throw new ForbiddenException('You can only request UGC for your own campaigns');
    }
    if (session.status !== SessionStatus.COMPLETED) {
      throw new BadRequestException('Can only request UGC for completed sessions');
    }

    // 2. Vérifier pas de doublon (même type, même session)
    const existing = await this.prisma.uGC.findFirst({
      where: {
        sessionId: dto.sessionId,
        type: dto.type,
        status: { notIn: [UGCStatus.CANCELLED, UGCStatus.DECLINED] },
      },
    });
    if (existing) {
      throw new BadRequestException(`A ${dto.type} UGC request already exists for this session`);
    }

    // 3. Pricing
    const pricing = await this.businessRulesService.getUgcPricing(dto.type);

    // 4. Si payant (VIDEO/PHOTO), créer PaymentIntent manual capture
    let stripePaymentIntentId: string | null = null;
    if (pricing.isPaid) {
      if (!dto.paymentMethodId) {
        throw new BadRequestException('paymentMethodId is required for paid UGC (VIDEO/PHOTO)');
      }

      const totalCharge = pricing.price + pricing.commission;
      const paymentIntent = await this.stripeService.createPaymentIntent(
        totalCharge,
        'eur',
        {
          platform: 'supertry',
          transactionType: 'UGC_PAYMENT',
          ugcType: dto.type,
          sessionId: dto.sessionId,
          campaignId: session.campaign.id,
          proId: userId,
          testerId: session.tester.id,
          capture_method: 'manual',
        },
      );

      // Confirmer avec la méthode de paiement du PRO (autorise sans capturer)
      await this.stripeService.confirmPaymentIntent(paymentIntent.id, dto.paymentMethodId);
      stripePaymentIntentId = paymentIntent.id;

      // Mettre à jour PlatformWallet escrow
      const platformWallet = await this.prisma.platformWallet.findFirst();
      if (platformWallet) {
        await this.prisma.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { increment: new Decimal(totalCharge) },
            totalReceived: { increment: new Decimal(totalCharge) },
          },
        });
      }
    }

    // 5. Calculer deadline
    const defaultDeadlineDays = await this.businessRulesService.getUgcDefaultDeadlineDays();
    const deadline = dto.deadline
      ? new Date(dto.deadline)
      : new Date(Date.now() + defaultDeadlineDays * 24 * 60 * 60 * 1000);

    // 6. Créer UGC
    const ugc = await this.prisma.uGC.create({
      data: {
        type: dto.type,
        description: dto.description,
        status: UGCStatus.REQUESTED,
        requestedBy: userId,
        submittedBy: session.tester.id,
        sessionId: dto.sessionId,
        deadline,
        requestedBonus: pricing.isPaid ? new Decimal(pricing.price) : null,
        stripePaymentIntentId,
      },
      include: UGC_INCLUDE,
    });

    // 7. Notifier le testeur
    if (session.tester.email) {
      await this.notificationsService.queueEmail({
        to: session.tester.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Nouvelle demande UGC',
        variables: {
          firstName: session.tester.firstName || 'Testeur',
          campaignTitle: session.campaign.title,
          ugcType: dto.type,
          description: dto.description,
          bonus: pricing.isPaid ? `${pricing.price}€` : 'Gratuit',
          deadline: deadline.toLocaleDateString('fr-FR'),
          message: `Le PRO a demandé un contenu ${dto.type} pour la campagne "${session.campaign.title}".${pricing.isPaid ? ` Bonus: ${pricing.price}€.` : ''} Deadline: ${deadline.toLocaleDateString('fr-FR')}.`,
        },
        metadata: {
          ugcId: ugc.id,
          sessionId: dto.sessionId,
          type: NotificationType.UGC_REQUESTED,
        },
      });
    }

    // 8. Audit
    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_REQUESTED', {
      ugcId: ugc.id,
      sessionId: dto.sessionId,
      campaignId: session.campaign.id,
      type: dto.type,
      isPaid: pricing.isPaid,
      price: pricing.price,
      commission: pricing.commission,
    });

    this.logger.log(`UGC requested: ${ugc.id} (${dto.type}) for session ${dto.sessionId}`);
    return ugc;
  }

  // ============================================================================
  // SUBMIT UGC (TESTER)
  // ============================================================================

  async submitUgc(ugcId: string, userId: string, dto: SubmitUgcDto, file?: Express.Multer.File) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');
    if (ugc.submittedBy !== userId) {
      throw new ForbiddenException('You are not the assigned tester for this UGC');
    }

    const validStatuses: UGCStatus[] = [UGCStatus.REQUESTED, UGCStatus.REJECTED];
    if (!validStatuses.includes(ugc.status)) {
      throw new BadRequestException(`Cannot submit UGC in ${ugc.status} status`);
    }

    // Upload ou URL selon le type
    let contentUrl = ugc.contentUrl;
    if (ugc.type === 'VIDEO' || ugc.type === 'PHOTO') {
      if (!file) throw new BadRequestException(`File upload is required for ${ugc.type} UGC`);
      const mediaType = ugc.type === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE;
      const result = await this.mediaService.upload(file, MediaFolder.UGC, mediaType, {
        subfolder: ugcId,
      });
      contentUrl = result.url;
    } else {
      if (!dto.contentUrl) throw new BadRequestException(`contentUrl is required for ${ugc.type} UGC`);
      contentUrl = dto.contentUrl;
    }

    const updated = await this.prisma.uGC.update({
      where: { id: ugcId },
      data: {
        status: UGCStatus.SUBMITTED,
        contentUrl,
        comment: dto.comment,
        submittedAt: new Date(),
        // Réinitialiser les champs de rejet
        rejectedAt: null,
        rejectionReason: null,
      },
      include: UGC_INCLUDE,
    });

    // Notifier le PRO
    if (ugc.requester?.email) {
      await this.notificationsService.queueEmail({
        to: ugc.requester.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'UGC soumis par le testeur',
        variables: {
          firstName: ugc.requester.firstName || 'PRO',
          ugcType: ugc.type,
          message: `Le testeur a soumis un contenu ${ugc.type}. Veuillez le vérifier et le valider ou le rejeter.`,
        },
        metadata: {
          ugcId,
          type: NotificationType.UGC_SUBMITTED,
        },
      });
    }

    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_SUBMITTED', {
      ugcId,
      type: ugc.type,
      hasFile: !!file,
    });

    this.logger.log(`UGC submitted: ${ugcId} by tester ${userId}`);
    return updated;
  }

  // ============================================================================
  // VALIDATE UGC (PRO) → PAIEMENT TESTEUR
  // ============================================================================

  async validateUgc(ugcId: string, userId: string, dto: ValidateUgcDto) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');
    if (ugc.requestedBy !== userId) {
      throw new ForbiddenException('You can only validate UGC you requested');
    }
    if (ugc.status !== UGCStatus.SUBMITTED) {
      throw new BadRequestException(`Cannot validate UGC in ${ugc.status} status`);
    }

    const pricing = await this.businessRulesService.getUgcPricing(ugc.type);

    // Si payant → capturer le PI et transférer au testeur
    if (pricing.isPaid && ugc.stripePaymentIntentId) {
      await this.processUgcPayment(ugc, pricing);
    }

    const updated = await this.prisma.uGC.update({
      where: { id: ugcId },
      data: {
        status: UGCStatus.VALIDATED,
        validatedAt: new Date(),
        validatedBy: userId,
        validationComment: dto.validationComment,
        paidBonus: pricing.isPaid ? new Decimal(pricing.price) : null,
      },
      include: UGC_INCLUDE,
    });

    // Notifier le testeur
    if (ugc.submitter?.email) {
      const message = pricing.isPaid
        ? `Votre ${ugc.type} UGC a été validé ! Vous recevez ${pricing.price}€.`
        : `Votre ${ugc.type} UGC a été validé ! Merci pour votre contribution.`;

      await this.notificationsService.queueEmail({
        to: ugc.submitter.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'UGC validé',
        variables: {
          firstName: ugc.submitter.firstName || 'Testeur',
          message,
        },
        metadata: {
          ugcId,
          type: NotificationType.UGC_VALIDATED,
        },
      });
    }

    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_VALIDATED', {
      ugcId,
      type: ugc.type,
      isPaid: pricing.isPaid,
      paidAmount: pricing.price,
      commission: pricing.commission,
    });

    this.logger.log(`UGC validated: ${ugcId} by PRO ${userId}`);
    return updated;
  }

  // ============================================================================
  // REJECT UGC (PRO)
  // ============================================================================

  async rejectUgc(ugcId: string, userId: string, dto: RejectUgcDto) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');
    if (ugc.requestedBy !== userId) {
      throw new ForbiddenException('You can only reject UGC you requested');
    }
    if (ugc.status !== UGCStatus.SUBMITTED) {
      throw new BadRequestException(`Cannot reject UGC in ${ugc.status} status`);
    }

    const newRejectionCount = ugc.rejectionCount + 1;
    const maxRejections = await this.businessRulesService.getMaxUgcRejections();

    // Auto-escalade en litige si max rejets atteint
    if (newRejectionCount >= maxRejections) {
      return this.autoEscalateToDispute(ugc, dto.rejectionReason, newRejectionCount, userId);
    }

    const updated = await this.prisma.uGC.update({
      where: { id: ugcId },
      data: {
        status: UGCStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: dto.rejectionReason,
        rejectionCount: newRejectionCount,
      },
      include: UGC_INCLUDE,
    });

    // Notifier le testeur
    if (ugc.submitter?.email) {
      await this.notificationsService.queueEmail({
        to: ugc.submitter.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'UGC rejeté - Modification demandée',
        variables: {
          firstName: ugc.submitter.firstName || 'Testeur',
          ugcType: ugc.type,
          rejectionReason: dto.rejectionReason,
          remainingAttempts: maxRejections - newRejectionCount,
          message: `Votre ${ugc.type} UGC a été rejeté. Raison: ${dto.rejectionReason}. Vous pouvez le resoumettre (${maxRejections - newRejectionCount} tentative(s) restante(s)).`,
        },
        metadata: {
          ugcId,
          type: NotificationType.UGC_REJECTED,
        },
      });
    }

    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_REJECTED', {
      ugcId,
      rejectionReason: dto.rejectionReason,
      rejectionCount: newRejectionCount,
      maxRejections,
    });

    this.logger.log(`UGC rejected: ${ugcId} (${newRejectionCount}/${maxRejections})`);
    return updated;
  }

  // ============================================================================
  // DECLINE UGC (TESTER)
  // ============================================================================

  async declineUgc(ugcId: string, userId: string, dto: DeclineUgcDto) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');
    if (ugc.submittedBy !== userId) {
      throw new ForbiddenException('You are not the assigned tester for this UGC');
    }

    const validStatuses: UGCStatus[] = [UGCStatus.REQUESTED, UGCStatus.REJECTED];
    if (!validStatuses.includes(ugc.status)) {
      throw new BadRequestException(`Cannot decline UGC in ${ugc.status} status`);
    }

    // Annuler le PI si payant (0 frais)
    if (ugc.stripePaymentIntentId) {
      await this.cancelUgcPaymentIntent(ugc.stripePaymentIntentId, ugcId);
    }

    const updated = await this.prisma.uGC.update({
      where: { id: ugcId },
      data: {
        status: UGCStatus.DECLINED,
        declinedAt: new Date(),
        declineReason: dto.declineReason,
      },
      include: UGC_INCLUDE,
    });

    // Notifier le PRO
    if (ugc.requester?.email) {
      await this.notificationsService.queueEmail({
        to: ugc.requester.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'UGC décliné par le testeur',
        variables: {
          firstName: ugc.requester.firstName || 'PRO',
          ugcType: ugc.type,
          message: `Le testeur a décliné votre demande de ${ugc.type} UGC.${dto.declineReason ? ` Raison: ${dto.declineReason}` : ''}`,
        },
        metadata: {
          ugcId,
          type: NotificationType.UGC_DECLINED,
        },
      });
    }

    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_DECLINED', {
      ugcId,
      declineReason: dto.declineReason,
    });

    this.logger.log(`UGC declined: ${ugcId} by tester ${userId}`);
    return updated;
  }

  // ============================================================================
  // CANCEL UGC (PRO)
  // ============================================================================

  async cancelUgc(ugcId: string, userId: string, dto: CancelUgcDto) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');
    if (ugc.requestedBy !== userId) {
      throw new ForbiddenException('You can only cancel UGC you requested');
    }
    if (ugc.status !== UGCStatus.REQUESTED) {
      throw new BadRequestException('Can only cancel UGC in REQUESTED status (before tester submits)');
    }

    // Annuler le PI si payant (0 frais)
    if (ugc.stripePaymentIntentId) {
      await this.cancelUgcPaymentIntent(ugc.stripePaymentIntentId, ugcId);
    }

    const updated = await this.prisma.uGC.update({
      where: { id: ugcId },
      data: {
        status: UGCStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: dto.cancellationReason,
      },
      include: UGC_INCLUDE,
    });

    // Notifier le testeur
    if (ugc.submitter?.email) {
      await this.notificationsService.queueEmail({
        to: ugc.submitter.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Demande UGC annulée',
        variables: {
          firstName: ugc.submitter.firstName || 'Testeur',
          ugcType: ugc.type,
          message: `La demande de ${ugc.type} UGC a été annulée par le PRO.`,
        },
        metadata: {
          ugcId,
          type: NotificationType.UGC_CANCELLED,
        },
      });
    }

    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_CANCELLED', {
      ugcId,
      cancellationReason: dto.cancellationReason,
    });

    this.logger.log(`UGC cancelled: ${ugcId} by PRO ${userId}`);
    return updated;
  }

  // ============================================================================
  // DISPUTE (MANUAL ESCALATION)
  // ============================================================================

  async createUgcDispute(ugcId: string, userId: string) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');

    const isRequester = ugc.requestedBy === userId;
    const isSubmitter = ugc.submittedBy === userId;
    if (!isRequester && !isSubmitter) {
      throw new ForbiddenException('You are not involved in this UGC');
    }

    const disputeableStatuses: UGCStatus[] = [UGCStatus.SUBMITTED, UGCStatus.REJECTED];
    if (!disputeableStatuses.includes(ugc.status)) {
      throw new BadRequestException(`Cannot dispute UGC in ${ugc.status} status`);
    }

    const updated = await this.prisma.uGC.update({
      where: { id: ugcId },
      data: {
        status: UGCStatus.DISPUTED,
        disputedAt: new Date(),
        disputeReason: `Manual escalation by ${isRequester ? 'PRO' : 'tester'}`,
      },
      include: UGC_INCLUDE,
    });

    // Notifier l'autre partie + admins
    await this.notifyDispute(ugc, isRequester ? 'PRO' : 'tester');

    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_DISPUTED', {
      ugcId,
      disputedBy: isRequester ? 'pro' : 'tester',
    });

    this.logger.log(`UGC dispute created: ${ugcId} by ${isRequester ? 'PRO' : 'tester'} ${userId}`);
    return updated;
  }

  // ============================================================================
  // RESOLVE DISPUTE (ADMIN)
  // ============================================================================

  async resolveUgcDispute(ugcId: string, adminId: string, dto: ResolveUgcDisputeDto) {
    const admin = await this.prisma.profile.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can resolve UGC disputes');
    }

    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');
    if (ugc.status !== UGCStatus.DISPUTED) {
      throw new BadRequestException('Can only resolve UGC in DISPUTED status');
    }

    const pricing = await this.businessRulesService.getUgcPricing(ugc.type);

    switch (dto.resolutionType) {
      case UgcDisputeResolutionType.PAY_TESTER:
        // Capturer PI + payer le testeur intégralement
        if (pricing.isPaid && ugc.stripePaymentIntentId) {
          await this.processUgcPayment(ugc, pricing);
        }
        break;

      case UgcDisputeResolutionType.REJECT_UGC:
        // Annuler PI (0 frais pour le PRO)
        if (ugc.stripePaymentIntentId) {
          await this.cancelUgcPaymentIntent(ugc.stripePaymentIntentId, ugcId);
        }
        break;

      case UgcDisputeResolutionType.PARTIAL_PAYMENT:
        if (!dto.partialAmount || dto.partialAmount <= 0) {
          throw new BadRequestException('partialAmount is required for partial payment');
        }
        if (pricing.isPaid && ugc.stripePaymentIntentId) {
          await this.processPartialUgcPayment(ugc, pricing, dto.partialAmount);
        }
        break;
    }

    const finalStatus = dto.resolutionType === UgcDisputeResolutionType.REJECT_UGC
      ? UGCStatus.DECLINED
      : UGCStatus.VALIDATED;

    const updated = await this.prisma.uGC.update({
      where: { id: ugcId },
      data: {
        status: finalStatus,
        disputeResolvedAt: new Date(),
        disputeResolution: dto.disputeResolution,
        disputeResolvedBy: adminId,
        paidBonus: dto.resolutionType === UgcDisputeResolutionType.PAY_TESTER
          ? new Decimal(pricing.price)
          : dto.resolutionType === UgcDisputeResolutionType.PARTIAL_PAYMENT
            ? new Decimal(dto.partialAmount!)
            : null,
      },
      include: UGC_INCLUDE,
    });

    // Notifier les deux parties
    for (const party of [ugc.requester, ugc.submitter]) {
      if (party?.email) {
        await this.notificationsService.queueEmail({
          to: party.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Litige UGC résolu',
          variables: {
            firstName: party.firstName || 'Utilisateur',
            resolution: dto.disputeResolution,
            message: `Le litige UGC a été résolu par un administrateur. Décision: ${dto.disputeResolution}`,
          },
          metadata: {
            ugcId,
            type: NotificationType.UGC_DISPUTE_RESOLVED,
          },
        });
      }
    }

    await this.auditService.log(adminId, AuditCategory.ADMIN, 'UGC_DISPUTE_RESOLVED', {
      ugcId,
      resolutionType: dto.resolutionType,
      disputeResolution: dto.disputeResolution,
      partialAmount: dto.partialAmount,
    });

    this.logger.log(`UGC dispute resolved: ${ugcId} → ${dto.resolutionType}`);
    return updated;
  }

  // ============================================================================
  // GET ENDPOINTS
  // ============================================================================

  async getMyRequests(userId: string, filterDto: UgcFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10, sessionId, status, type } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { requestedBy: userId };
    if (sessionId) where.sessionId = sessionId;
    if (status) where.status = status;
    if (type) where.type = type;

    const [ugcs, total] = await Promise.all([
      this.prisma.uGC.findMany({
        where,
        skip,
        take: limit,
        include: UGC_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.uGC.count({ where }),
    ]);

    return createPaginatedResponse(ugcs, total, page, limit);
  }

  async getMySubmissions(userId: string, filterDto: UgcFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10, sessionId, status, type } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { submittedBy: userId };
    if (sessionId) where.sessionId = sessionId;
    if (status) where.status = status;
    if (type) where.type = type;

    const [ugcs, total] = await Promise.all([
      this.prisma.uGC.findMany({
        where,
        skip,
        take: limit,
        include: UGC_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.uGC.count({ where }),
    ]);

    return createPaginatedResponse(ugcs, total, page, limit);
  }

  async getUgcDetail(ugcId: string, userId: string) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new NotFoundException('UGC not found');

    // Vérifier accès : requester, submitter, ou admin
    const profile = await this.prisma.profile.findUnique({ where: { id: userId } });
    const isInvolved = ugc.requestedBy === userId || ugc.submittedBy === userId;
    if (!isInvolved && profile?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You do not have access to this UGC');
    }

    return ugc;
  }

  async getUgcDisputes(): Promise<any[]> {
    return this.prisma.uGC.findMany({
      where: { status: UGCStatus.DISPUTED },
      include: UGC_INCLUDE,
      orderBy: { disputedAt: 'desc' },
    });
  }

  async getSessionUgcs(sessionId: string, userId: string) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: { campaign: { select: { sellerId: true } } },
    });

    if (!session) throw new NotFoundException('Session not found');

    const isInvolved = session.testerId === userId || session.campaign.sellerId === userId;
    if (!isInvolved) {
      throw new ForbiddenException('You are not involved in this session');
    }

    return this.prisma.uGC.findMany({
      where: { sessionId },
      include: UGC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async processUgcPayment(ugc: any, pricing: { price: number; commission: number }) {
    // 1. Capturer le PaymentIntent
    await this.stripeService.capturePaymentIntent(ugc.stripePaymentIntentId);

    // 2. Vérifier que le testeur a un compte Stripe Connect
    const testerStripeAccount = ugc.submitter?.stripeConnectAccountId
      || ugc.session?.tester?.stripeConnectAccountId;

    if (!testerStripeAccount) {
      throw new BadRequestException('Tester has no Stripe Connect account. Cannot transfer payment.');
    }

    // 3. Transfert Stripe vers le testeur
    const transfer = await this.stripeService.createPlatformToConnectTransfer(
      pricing.price,
      testerStripeAccount,
      'eur',
      {
        platform: 'supertry',
        transactionType: 'UGC_PAYMENT',
        ugcId: ugc.id,
        ugcType: ugc.type,
        sessionId: ugc.sessionId,
        campaignId: ugc.session?.campaign?.id,
      },
    );

    // 4. Transactions DB dans une transaction atomique
    await this.prisma.$transaction(async (tx) => {
      // Wallet testeur
      let testerWallet = await tx.wallet.findUnique({ where: { userId: ugc.submittedBy! } });
      if (!testerWallet) {
        testerWallet = await tx.wallet.create({
          data: { userId: ugc.submittedBy!, balance: 0, pendingBalance: 0, totalEarned: 0, totalWithdrawn: 0 },
        });
      }

      // Transaction UGC_PAYMENT
      await tx.transaction.create({
        data: {
          walletId: testerWallet.id,
          type: TransactionType.UGC_PAYMENT,
          amount: new Decimal(pricing.price),
          reason: `UGC ${ugc.type} payment`,
          ugcId: ugc.id,
          sessionId: ugc.sessionId,
          campaignId: ugc.session?.campaign?.id,
          stripeTransferId: transfer.id,
          status: TransactionStatus.COMPLETED,
        },
      });

      // Transaction UGC_COMMISSION
      await tx.transaction.create({
        data: {
          walletId: null,
          type: TransactionType.UGC_COMMISSION,
          amount: new Decimal(pricing.commission),
          reason: `UGC ${ugc.type} commission`,
          ugcId: ugc.id,
          sessionId: ugc.sessionId,
          campaignId: ugc.session?.campaign?.id,
          status: TransactionStatus.COMPLETED,
        },
      });

      // Update wallet testeur
      await tx.wallet.update({
        where: { id: testerWallet.id },
        data: {
          balance: { increment: new Decimal(pricing.price) },
          totalEarned: { increment: new Decimal(pricing.price) },
          lastCreditedAt: new Date(),
        },
      });

      // Update PlatformWallet
      const platformWallet = await tx.platformWallet.findFirst();
      if (platformWallet) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { decrement: new Decimal(pricing.price + pricing.commission) },
            commissionBalance: { increment: new Decimal(pricing.commission) },
            totalTransferred: { increment: new Decimal(pricing.price) },
            totalCommissions: { increment: new Decimal(pricing.commission) },
          },
        });
      }
    });

    this.logger.log(`UGC payment processed: ${ugc.id} → ${pricing.price}€ to tester, ${pricing.commission}€ commission`);
  }

  private async processPartialUgcPayment(ugc: any, pricing: { price: number; commission: number }, partialAmount: number) {
    if (partialAmount > pricing.price) {
      throw new BadRequestException(`Partial amount (${partialAmount}€) cannot exceed UGC price (${pricing.price}€)`);
    }

    // 1. Capturer le PI
    await this.stripeService.capturePaymentIntent(ugc.stripePaymentIntentId);

    // 2. Transfert partiel au testeur
    const testerStripeAccount = ugc.submitter?.stripeConnectAccountId
      || ugc.session?.tester?.stripeConnectAccountId;

    if (!testerStripeAccount) {
      throw new BadRequestException('Tester has no Stripe Connect account');
    }

    const transfer = await this.stripeService.createPlatformToConnectTransfer(
      partialAmount,
      testerStripeAccount,
      'eur',
      { ugcId: ugc.id, transactionType: 'UGC_PARTIAL_PAYMENT' },
    );

    // 3. Refund du reste au PRO
    const refundAmount = pricing.price - partialAmount;
    if (refundAmount > 0) {
      await this.stripeService.createRefund(
        ugc.stripePaymentIntentId,
        refundAmount,
        'requested_by_customer',
        { ugcId: ugc.id, transactionType: 'UGC_PARTIAL_REFUND' },
      );
    }

    // 4. Transactions DB
    await this.prisma.$transaction(async (tx) => {
      let testerWallet = await tx.wallet.findUnique({ where: { userId: ugc.submittedBy! } });
      if (!testerWallet) {
        testerWallet = await tx.wallet.create({
          data: { userId: ugc.submittedBy!, balance: 0, pendingBalance: 0, totalEarned: 0, totalWithdrawn: 0 },
        });
      }

      await tx.transaction.create({
        data: {
          walletId: testerWallet.id,
          type: TransactionType.UGC_PAYMENT,
          amount: new Decimal(partialAmount),
          reason: `UGC ${ugc.type} partial payment (dispute resolution)`,
          ugcId: ugc.id,
          sessionId: ugc.sessionId,
          stripeTransferId: transfer.id,
          status: TransactionStatus.COMPLETED,
        },
      });

      // Commission proportionnelle
      const proportionalCommission = (pricing.commission * partialAmount) / pricing.price;
      await tx.transaction.create({
        data: {
          walletId: null,
          type: TransactionType.UGC_COMMISSION,
          amount: new Decimal(proportionalCommission),
          reason: `UGC ${ugc.type} commission (partial - dispute resolution)`,
          ugcId: ugc.id,
          sessionId: ugc.sessionId,
          status: TransactionStatus.COMPLETED,
        },
      });

      await tx.wallet.update({
        where: { id: testerWallet.id },
        data: {
          balance: { increment: new Decimal(partialAmount) },
          totalEarned: { increment: new Decimal(partialAmount) },
          lastCreditedAt: new Date(),
        },
      });

      const platformWallet = await tx.platformWallet.findFirst();
      if (platformWallet) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { decrement: new Decimal(pricing.price + pricing.commission) },
            commissionBalance: { increment: new Decimal(proportionalCommission) },
            totalTransferred: { increment: new Decimal(partialAmount) },
            totalCommissions: { increment: new Decimal(proportionalCommission) },
          },
        });
      }
    });

    this.logger.log(`UGC partial payment: ${ugc.id} → ${partialAmount}€ to tester, ${refundAmount}€ refunded to PRO`);
  }

  private async cancelUgcPaymentIntent(paymentIntentId: string, ugcId: string) {
    try {
      await this.stripeService.cancelPaymentIntent(paymentIntentId, 'abandoned');

      // Décrémenter l'escrow
      const pricing = await this.prisma.uGC.findUnique({
        where: { id: ugcId },
        select: { requestedBonus: true, type: true },
      });

      if (pricing?.requestedBonus) {
        const ugcPricing = await this.businessRulesService.getUgcPricing(pricing.type);
        const totalCharge = Number(pricing.requestedBonus) + ugcPricing.commission;

        const platformWallet = await this.prisma.platformWallet.findFirst();
        if (platformWallet) {
          await this.prisma.platformWallet.update({
            where: { id: platformWallet.id },
            data: {
              escrowBalance: { decrement: new Decimal(totalCharge) },
              totalReceived: { decrement: new Decimal(totalCharge) },
            },
          });
        }
      }

      this.logger.log(`UGC PaymentIntent cancelled: ${paymentIntentId}`);
    } catch (error) {
      this.logger.error(`Failed to cancel UGC PaymentIntent ${paymentIntentId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to cancel UGC payment');
    }
  }

  private async autoEscalateToDispute(ugc: any, lastRejectionReason: string, rejectionCount: number, proId: string) {
    const updated = await this.prisma.uGC.update({
      where: { id: ugc.id },
      data: {
        status: UGCStatus.DISPUTED,
        rejectedAt: new Date(),
        rejectionReason: lastRejectionReason,
        rejectionCount,
        disputedAt: new Date(),
        disputeReason: `Auto-escalated after ${rejectionCount} rejections`,
      },
      include: UGC_INCLUDE,
    });

    await this.notifyDispute(ugc, 'system');

    await this.auditService.log(proId, AuditCategory.SESSION, 'UGC_AUTO_DISPUTED', {
      ugcId: ugc.id,
      rejectionCount,
      lastRejectionReason,
    });

    this.logger.log(`UGC auto-escalated to dispute: ${ugc.id} after ${rejectionCount} rejections`);
    return updated;
  }

  private async notifyDispute(ugc: any, escalatedBy: string) {
    // Notifier les deux parties
    for (const party of [ugc.requester, ugc.submitter]) {
      if (party?.email) {
        await this.notificationsService.queueEmail({
          to: party.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Litige UGC créé',
          variables: {
            firstName: party.firstName || 'Utilisateur',
            ugcType: ugc.type,
            message: `Un litige a été créé pour le ${ugc.type} UGC (escaladé par ${escalatedBy}). Un administrateur va examiner la situation.`,
          },
          metadata: {
            ugcId: ugc.id,
            type: NotificationType.UGC_DISPUTED,
          },
        });
      }
    }

    // Notifier tous les admins
    const admins = await this.prisma.profile.findMany({ where: { role: UserRole.ADMIN } });
    for (const admin of admins) {
      if (admin.email) {
        await this.notificationsService.queueEmail({
          to: admin.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Nouveau litige UGC à traiter',
          variables: {
            firstName: admin.firstName || 'Admin',
            ugcType: ugc.type,
            message: `Litige UGC à traiter. Type: ${ugc.type}. Escaladé par: ${escalatedBy}.`,
          },
          metadata: {
            ugcId: ugc.id,
            type: NotificationType.UGC_DISPUTED,
          },
        });
      }
    }
  }
}
