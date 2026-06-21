import {
  Injectable,
  Logger,
  HttpStatus,
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
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
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

    if (!session) throw new I18nHttpException('dispute.session_not_found', 'SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (session.campaign.sellerId !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }
    const ugcIneligibleStatuses: SessionStatus[] = [
      SessionStatus.PENDING,
      SessionStatus.REJECTED,
      SessionStatus.CANCELLED,
      SessionStatus.DISPUTED,
    ];
    if (ugcIneligibleStatuses.includes(session.status)) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
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
      throw new I18nHttpException('common.duplicate', 'UGC_DUPLICATE', HttpStatus.BAD_REQUEST, { field: dto.type });
    }

    // 3. Pricing
    const pricing = await this.businessRulesService.getUgcPricing(dto.type);

    // 4. Calculer deadline (doit rester < seuil d'expiration Stripe, cf. business rules)
    const defaultDeadlineDays = await this.businessRulesService.getUgcDefaultDeadlineDays();
    const deadline = dto.deadline
      ? new Date(dto.deadline)
      : new Date(Date.now() + defaultDeadlineDays * 24 * 60 * 60 * 1000);

    // 5. Si payant (VIDEO/PHOTO), créer + confirmer PaymentIntent en CAPTURE MANUELLE.
    //    L'escrow n'est financé qu'une fois l'autorisation effective (requires_capture),
    //    pour ne pas compter de fonds tant qu'une étape 3DS/SCA est en attente.
    const totalCharge = pricing.isPaid ? pricing.price + pricing.commission : 0;
    let stripePaymentIntentId: string | null = null;
    let requiresAction = false;
    let clientSecret: string | null = null;

    if (pricing.isPaid) {
      if (!dto.paymentMethodId) {
        throw new I18nHttpException('ugc.payment_required', 'UGC_PAYMENT_REQUIRED', HttpStatus.BAD_REQUEST);
      }

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
        },
        { captureMethod: 'manual' }, // ⚠️ capture manuelle réelle (était inopérante avant)
      );
      stripePaymentIntentId = paymentIntent.id;

      // Confirmer avec la méthode de paiement du PRO (autorise sans capturer)
      const confirmed = await this.stripeService.confirmPaymentIntent(
        paymentIntent.id,
        dto.paymentMethodId,
      );

      if (confirmed.status === 'requires_action') {
        // 3DS/SCA requis → on renvoie le client_secret, l'escrow sera financé après confirmation
        requiresAction = true;
        clientSecret = confirmed.client_secret ?? null;
      } else if (confirmed.status !== 'requires_capture' && confirmed.status !== 'succeeded') {
        // Autorisation échouée → annuler proprement le PI
        await this.stripeService
          .cancelPaymentIntent(paymentIntent.id, 'abandoned')
          .catch(() => undefined);
        throw new I18nHttpException(
          'ugc.payment_authorization_failed',
          'UGC_PAYMENT_AUTH_FAILED',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

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

    // 7. Financer l'escrow seulement si l'autorisation est effective (pas en attente 3DS)
    if (pricing.isPaid && !requiresAction) {
      await this.fundEscrowOnce(ugc.id, totalCharge);
    }

    // 8. Notifier le testeur uniquement si la demande est effective (sinon après 3DS)
    if (!requiresAction) {
      await this.notifyUgc(
        { id: session.tester.id, email: session.tester.email, firstName: session.tester.firstName },
        'ugc_requested',
        { ugcType: dto.type, campaignTitle: session.campaign.title, deadline: deadline.toLocaleDateString('fr-FR') },
        NotificationType.UGC_REQUESTED,
        ugc.id,
      );
    }

    // 9. Audit
    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_REQUESTED', {
      ugcId: ugc.id,
      sessionId: dto.sessionId,
      campaignId: session.campaign.id,
      type: dto.type,
      isPaid: pricing.isPaid,
      price: pricing.price,
      commission: pricing.commission,
      requiresAction,
    });

    this.logger.log(`UGC requested: ${ugc.id} (${dto.type}) for session ${dto.sessionId}${requiresAction ? ' [3DS pending]' : ''}`);
    return { ...ugc, requiresAction, clientSecret };
  }

  // ============================================================================
  // CONFIRM AUTHORIZATION (PRO) — après 3DS/SCA
  // ============================================================================

  async confirmUgcAuthorization(ugcId: string, userId: string) {
    const ugc = await this.prisma.uGC.findUnique({ where: { id: ugcId }, include: UGC_INCLUDE });
    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.requestedBy !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }
    if (ugc.status !== UGCStatus.REQUESTED || !ugc.stripePaymentIntentId) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    const pi = await this.stripeService.getPaymentIntent(ugc.stripePaymentIntentId);

    if (pi.status === 'requires_capture' || pi.status === 'succeeded') {
      const pricing = await this.businessRulesService.getUgcPricing(ugc.type);
      await this.fundEscrowOnce(ugc.id, pricing.price + pricing.commission);

      // Notifier le testeur maintenant que l'autorisation est effective
      await this.notifyUgc(
        ugc.submitter,
        'ugc_requested',
        { ugcType: ugc.type, campaignTitle: ugc.session?.campaign?.title ?? '', deadline: ugc.deadline ? new Date(ugc.deadline).toLocaleDateString('fr-FR') : '' },
        NotificationType.UGC_REQUESTED,
        ugc.id,
      );

      await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_AUTH_CONFIRMED', { ugcId: ugc.id });
      this.logger.log(`UGC authorization confirmed: ${ugc.id}`);
      return this.prisma.uGC.findUnique({ where: { id: ugcId }, include: UGC_INCLUDE });
    }

    if (pi.status === 'requires_action') {
      throw new I18nHttpException('ugc.payment_action_pending', 'UGC_PAYMENT_ACTION_PENDING', HttpStatus.BAD_REQUEST);
    }

    // Échec définitif → annuler le PI et la demande
    await this.stripeService.cancelPaymentIntent(ugc.stripePaymentIntentId, 'abandoned').catch(() => undefined);
    await this.prisma.uGC.update({
      where: { id: ugcId },
      data: { status: UGCStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: 'Payment authorization failed' },
    });
    throw new I18nHttpException('ugc.payment_authorization_failed', 'UGC_PAYMENT_AUTH_FAILED', HttpStatus.BAD_REQUEST);
  }

  // ============================================================================
  // REAUTHORIZE PAYMENT (PRO) — autorisation expirée avant validation
  // ============================================================================

  async reauthorizeUgcPayment(ugcId: string, userId: string, paymentMethodId: string) {
    const ugc = await this.prisma.uGC.findUnique({ where: { id: ugcId }, include: UGC_INCLUDE });
    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.requestedBy !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }
    if (ugc.status !== UGCStatus.SUBMITTED) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    const pricing = await this.businessRulesService.getUgcPricing(ugc.type);
    if (!pricing.isPaid) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    const totalCharge = pricing.price + pricing.commission;
    const paymentIntent = await this.stripeService.createPaymentIntent(
      totalCharge,
      'eur',
      {
        platform: 'supertry',
        transactionType: 'UGC_PAYMENT',
        ugcType: ugc.type,
        sessionId: ugc.sessionId,
        proId: userId,
        reauthorizationOf: ugc.stripePaymentIntentId ?? '',
      },
      { captureMethod: 'manual' },
    );
    const confirmed = await this.stripeService.confirmPaymentIntent(paymentIntent.id, paymentMethodId);

    if (confirmed.status === 'requires_action') {
      await this.prisma.uGC.update({ where: { id: ugcId }, data: { stripePaymentIntentId: paymentIntent.id } });
      return { requiresAction: true, clientSecret: confirmed.client_secret ?? null };
    }
    if (confirmed.status !== 'requires_capture' && confirmed.status !== 'succeeded') {
      await this.stripeService.cancelPaymentIntent(paymentIntent.id, 'abandoned').catch(() => undefined);
      throw new I18nHttpException('ugc.payment_authorization_failed', 'UGC_PAYMENT_AUTH_FAILED', HttpStatus.BAD_REQUEST);
    }

    // Nouvelle autorisation OK → remplacer le PI. Financer l'escrow seulement s'il ne l'était pas déjà.
    await this.prisma.uGC.update({ where: { id: ugcId }, data: { stripePaymentIntentId: paymentIntent.id } });
    if (!ugc.escrowFundedAt) {
      await this.fundEscrowOnce(ugc.id, totalCharge);
    }

    await this.auditService.log(userId, AuditCategory.SESSION, 'UGC_PAYMENT_REAUTHORIZED', { ugcId: ugc.id });
    this.logger.log(`UGC payment reauthorized: ${ugc.id} → new PI ${paymentIntent.id}`);
    return { requiresAction: false, clientSecret: null };
  }

  // ============================================================================
  // SUBMIT UGC (TESTER)
  // ============================================================================

  async submitUgc(ugcId: string, userId: string, dto: SubmitUgcDto, file?: Express.Multer.File) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.submittedBy !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    const validStatuses: UGCStatus[] = [UGCStatus.REQUESTED, UGCStatus.REJECTED];
    if (!validStatuses.includes(ugc.status)) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
    }

    // Garde : pour un UGC payant, refuser la soumission tant que l'autorisation
    // de paiement du PRO n'est pas effective (escrow financé). Évite qu'un testeur
    // produise un contenu alors qu'une étape 3DS du PRO n'a jamais abouti.
    if (ugc.stripePaymentIntentId && !ugc.escrowFundedAt) {
      throw new I18nHttpException(
        'ugc.payment_not_authorized',
        'UGC_PAYMENT_NOT_AUTHORIZED',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Upload ou URL selon le type
    let contentUrl = ugc.contentUrl;
    if (ugc.type === 'VIDEO' || ugc.type === 'PHOTO') {
      if (!file) throw new I18nHttpException('ugc.file_required', 'UGC_FILE_REQUIRED', HttpStatus.BAD_REQUEST, { type: ugc.type });
      const mediaType = ugc.type === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE;
      const result = await this.mediaService.upload(file, MediaFolder.UGC, mediaType, {
        subfolder: ugcId,
      });
      contentUrl = result.key;
    } else {
      if (!dto.contentUrl) throw new I18nHttpException('ugc.content_url_required', 'UGC_CONTENT_URL_REQUIRED', HttpStatus.BAD_REQUEST);
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
    await this.notifyUgc(
      ugc.requester,
      'ugc_submitted',
      { ugcType: ugc.type },
      NotificationType.UGC_SUBMITTED,
      ugcId,
    );

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

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.requestedBy !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }
    if (ugc.status !== UGCStatus.SUBMITTED) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
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
    await this.notifyUgc(
      ugc.submitter,
      'ugc_validated',
      {
        ugcType: ugc.type,
        paymentInfo: pricing.isPaid
          ? `Vous recevez ${pricing.price}€.`
          : 'Merci pour votre contribution.',
      },
      NotificationType.UGC_VALIDATED,
      ugcId,
    );

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

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.requestedBy !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }
    if (ugc.status !== UGCStatus.SUBMITTED) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
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
    await this.notifyUgc(
      ugc.submitter,
      'ugc_rejected',
      {
        ugcType: ugc.type,
        rejectionReason: dto.rejectionReason,
        remainingAttempts: maxRejections - newRejectionCount,
      },
      NotificationType.UGC_REJECTED,
      ugcId,
    );

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

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.submittedBy !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    const validStatuses: UGCStatus[] = [UGCStatus.REQUESTED, UGCStatus.REJECTED];
    if (!validStatuses.includes(ugc.status)) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
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
    await this.notifyUgc(
      ugc.requester,
      'ugc_declined',
      { ugcType: ugc.type },
      NotificationType.UGC_DECLINED,
      ugcId,
    );

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

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.requestedBy !== userId) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }
    if (ugc.status !== UGCStatus.REQUESTED) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
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
    await this.notifyUgc(
      ugc.submitter,
      'ugc_cancelled',
      { ugcType: ugc.type },
      NotificationType.UGC_CANCELLED,
      ugcId,
    );

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

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);

    const isRequester = ugc.requestedBy === userId;
    const isSubmitter = ugc.submittedBy === userId;
    if (!isRequester && !isSubmitter) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    const disputeableStatuses: UGCStatus[] = [UGCStatus.SUBMITTED, UGCStatus.REJECTED];
    if (!disputeableStatuses.includes(ugc.status)) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
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
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (ugc.status !== UGCStatus.DISPUTED) {
      throw new I18nHttpException('ugc.invalid_status', 'UGC_INVALID_STATUS', HttpStatus.BAD_REQUEST);
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
          throw new I18nHttpException('ugc.payment_required', 'UGC_PARTIAL_AMOUNT_REQUIRED', HttpStatus.BAD_REQUEST);
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
      await this.notifyUgc(
        party,
        'ugc_dispute_resolved',
        { ugcType: ugc.type, resolution: dto.disputeResolution },
        NotificationType.UGC_DISPUTE_RESOLVED,
        ugcId,
      );
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
  // PRICING (public au front authentifié) — P2.1
  // ============================================================================

  /**
   * Tarifs UGC courants (issus des business rules, configurables par l'admin).
   * Le front consomme cette source de vérité au lieu de prix codés en dur.
   */
  async getPublicPricing() {
    const [video, photo] = await Promise.all([
      this.businessRulesService.getUgcPricing(UGCType.VIDEO),
      this.businessRulesService.getUgcPricing(UGCType.PHOTO),
    ]);
    return {
      currency: 'EUR',
      VIDEO: { price: video.price, commission: video.commission, total: video.price + video.commission },
      PHOTO: { price: photo.price, commission: photo.commission, total: photo.price + photo.commission },
    };
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

    const resolved = await this.resolveUgcListContentUrls(ugcs);
    return createPaginatedResponse(resolved, total, page, limit);
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

    const resolved = await this.resolveUgcListContentUrls(ugcs);
    return createPaginatedResponse(resolved, total, page, limit);
  }

  async getUgcDetail(ugcId: string, userId: string) {
    const ugc = await this.prisma.uGC.findUnique({
      where: { id: ugcId },
      include: UGC_INCLUDE,
    });

    if (!ugc) throw new I18nHttpException('ugc.not_found', 'UGC_NOT_FOUND', HttpStatus.NOT_FOUND);

    // Vérifier accès : requester, submitter, ou admin
    const profile = await this.prisma.profile.findUnique({ where: { id: userId } });
    const isInvolved = ugc.requestedBy === userId || ugc.submittedBy === userId;
    if (!isInvolved && profile?.role !== UserRole.ADMIN) {
      throw new I18nHttpException('ugc.not_owner', 'UGC_NOT_OWNER', HttpStatus.FORBIDDEN);
    }

    return this.resolveUgcContentUrls(ugc);
  }

  async getUgcDisputes(): Promise<any[]> {
    const ugcs = await this.prisma.uGC.findMany({
      where: { status: UGCStatus.DISPUTED },
      include: UGC_INCLUDE,
      orderBy: { disputedAt: 'desc' },
    });
    return this.resolveUgcListContentUrls(ugcs);
  }

  async getSessionUgcs(sessionId: string, userId: string) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: { campaign: { select: { sellerId: true } } },
    });

    if (!session) throw new I18nHttpException('dispute.session_not_found', 'SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);

    const isInvolved = session.testerId === userId || session.campaign.sellerId === userId;
    if (!isInvolved) {
      throw new I18nHttpException('common.forbidden', 'FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const ugcs = await this.prisma.uGC.findMany({
      where: { sessionId },
      include: UGC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return this.resolveUgcListContentUrls(ugcs);
  }

  // ============================================================================
  // SIGNED URL HELPERS
  // ============================================================================

  /**
   * Résout le contentUrl d'un UGC : si c'est une key S3 (pas une URL), génère une signed URL.
   * Les URLs externes (TEXT_REVIEW, EXTERNAL_REVIEW) et les anciennes URLs publiques sont retournées telles quelles.
   */
  private async resolveContentUrl(contentUrl: string | null): Promise<string | null> {
    if (!contentUrl) return null;
    // Si c'est déjà une URL (http/https), retourner tel quel
    if (contentUrl.startsWith('http://') || contentUrl.startsWith('https://')) {
      // Pour les anciennes URLs publiques Supabase qui ne fonctionnent pas,
      // on extrait la key et on génère une signed URL
      const key = this.mediaService.extractKeyFromUrl(contentUrl);
      if (key) {
        return this.mediaService.getSignedUrl(key, 3600);
      }
      return contentUrl;
    }
    // C'est une key S3 → générer une signed URL (1h)
    return this.mediaService.getSignedUrl(contentUrl, 3600);
  }

  private async resolveUgcContentUrls<T extends { contentUrl?: string | null }>(ugc: T): Promise<T> {
    if (ugc.contentUrl) {
      return { ...ugc, contentUrl: await this.resolveContentUrl(ugc.contentUrl) };
    }
    return ugc;
  }

  private async resolveUgcListContentUrls<T extends { contentUrl?: string | null }>(ugcs: T[]): Promise<T[]> {
    return Promise.all(ugcs.map((ugc) => this.resolveUgcContentUrls(ugc)));
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async processUgcPayment(ugc: any, pricing: { price: number; commission: number }) {
    // 0. Garde d'idempotence : si un paiement UGC a déjà été enregistré, ne pas rejouer
    //    (évite tout double transfert en cas de retry après une erreur transitoire).
    const alreadyPaid = await this.prisma.transaction.findFirst({
      where: { ugcId: ugc.id, type: TransactionType.UGC_PAYMENT, status: TransactionStatus.COMPLETED },
    });
    if (alreadyPaid) {
      this.logger.warn(`UGC ${ugc.id} already has a completed UGC_PAYMENT transaction — skipping`);
      return;
    }

    // 1. Vérifier le statut du PI avant capture
    const pi = await this.stripeService.getPaymentIntent(ugc.stripePaymentIntentId);

    if (pi.status === 'succeeded') {
      this.logger.log(`PI ${ugc.stripePaymentIntentId} already captured (succeeded), skipping capture`);
    } else if (pi.status === 'requires_capture') {
      // Clé d'idempotence déterministe : un retry ne capturera pas deux fois
      await this.stripeService.capturePaymentIntent(ugc.stripePaymentIntentId, `ugc-capture-${ugc.id}`);
    } else if (
      pi.status === 'canceled' ||
      pi.status === 'requires_payment_method' ||
      pi.status === 'requires_action'
    ) {
      // L'autorisation a expiré ou n'est plus valide → erreur métier explicite et
      // actionnable (le PRO doit ré-autoriser), au lieu d'un 500 opaque qui bloque l'UGC.
      this.logger.error(`PI ${ugc.stripePaymentIntentId} authorization expired/invalid: ${pi.status}`);
      throw new I18nHttpException(
        'ugc.payment_authorization_expired',
        'UGC_PAYMENT_AUTH_EXPIRED',
        HttpStatus.BAD_REQUEST,
      );
    } else {
      this.logger.error(`PI ${ugc.stripePaymentIntentId} in unexpected status: ${pi.status}`);
      throw new I18nHttpException(
        'stripe.capture_payment_failed',
        'STRIPE_CAPTURE_PAYMENT_FAILED',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 2. Vérifier que le testeur a un compte Stripe Connect
    const testerStripeAccount = ugc.submitter?.stripeConnectAccountId
      || ugc.session?.tester?.stripeConnectAccountId;

    if (!testerStripeAccount) {
      throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.NOT_FOUND);
    }

    // 3. Transfert Stripe vers le testeur (clé d'idempotence déterministe par ugcId)
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
      undefined,
      undefined,
      `ugc-transfer-${ugc.id}`,
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
      throw new I18nHttpException('ugc.invalid_status', 'UGC_PARTIAL_AMOUNT_EXCEEDS', HttpStatus.BAD_REQUEST);
    }

    // 1. Capturer le PI
    await this.stripeService.capturePaymentIntent(ugc.stripePaymentIntentId);

    // 2. Transfert partiel au testeur
    const testerStripeAccount = ugc.submitter?.stripeConnectAccountId
      || ugc.session?.tester?.stripeConnectAccountId;

    if (!testerStripeAccount) {
      throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.NOT_FOUND);
    }

    const transfer = await this.stripeService.createPlatformToConnectTransfer(
      partialAmount,
      testerStripeAccount,
      'eur',
      { ugcId: ugc.id, transactionType: 'UGC_PARTIAL_PAYMENT' },
    );

    // 3. Refund du reste au PRO
    const refundAmount = pricing.price - partialAmount;
    let proRefund: { id: string } | null = null;
    if (refundAmount > 0) {
      proRefund = await this.stripeService.createRefund(
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

      // Transaction refund PRO
      if (proRefund) {
        await tx.transaction.create({
          data: {
            walletId: null,
            type: TransactionType.REFUND,
            amount: new Decimal(refundAmount),
            reason: `UGC ${ugc.type} partial refund to PRO (dispute resolution)`,
            ugcId: ugc.id,
            sessionId: ugc.sessionId,
            stripeRefundId: proRefund.id,
            status: TransactionStatus.COMPLETED,
          },
        });
      }

      // Commission proportionnelle, arrondie au centime (Stripe = centimes entiers)
      const proportionalCommission =
        Math.round(((pricing.commission * partialAmount) / pricing.price) * 100) / 100;
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
      // Libérer l'escrow de façon idempotente (seulement s'il avait été financé)
      await this.releaseEscrowOnce(ugcId);
      this.logger.log(`UGC PaymentIntent cancelled: ${paymentIntentId}`);
    } catch (error) {
      this.logger.error(`Failed to cancel UGC PaymentIntent ${paymentIntentId}: ${error.message}`);
      throw new I18nHttpException('common.internal_error', 'UGC_CANCEL_PAYMENT_FAILED', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ============================================================================
  // ESCROW HELPERS (idempotents via UGC.escrowFundedAt)
  // ============================================================================

  /** Crédite l'escrow plateforme une seule fois pour un UGC donné. */
  private async fundEscrowOnce(ugcId: string, totalCharge: number) {
    await this.prisma.$transaction(async (tx) => {
      const ugc = await tx.uGC.findUnique({ where: { id: ugcId }, select: { escrowFundedAt: true } });
      if (!ugc || ugc.escrowFundedAt) return; // déjà financé → no-op

      const platformWallet = await tx.platformWallet.findFirst();
      if (platformWallet) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { increment: new Decimal(totalCharge) },
            totalReceived: { increment: new Decimal(totalCharge) },
          },
        });
      }
      await tx.uGC.update({ where: { id: ugcId }, data: { escrowFundedAt: new Date() } });
    });
  }

  /** Libère l'escrow plateforme une seule fois (montant = bonus + commission). */
  private async releaseEscrowOnce(ugcId: string) {
    await this.prisma.$transaction(async (tx) => {
      const ugc = await tx.uGC.findUnique({
        where: { id: ugcId },
        select: { escrowFundedAt: true, requestedBonus: true, type: true },
      });
      if (!ugc || !ugc.escrowFundedAt) return; // jamais financé → no-op

      const ugcPricing = await this.businessRulesService.getUgcPricing(ugc.type);
      const totalCharge = Number(ugc.requestedBonus ?? ugcPricing.price) + ugcPricing.commission;

      const platformWallet = await tx.platformWallet.findFirst();
      if (platformWallet) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { decrement: new Decimal(totalCharge) },
            totalReceived: { decrement: new Decimal(totalCharge) },
          },
        });
      }
      await tx.uGC.update({ where: { id: ugcId }, data: { escrowFundedAt: null } });
    });
  }

  // ============================================================================
  // SCHEDULER HOOKS (appelés par UgcScheduler) — P0.2
  // ============================================================================

  /**
   * Expire les demandes UGC jamais acceptées (statut REQUESTED) dont la deadline
   * est dépassée : annule le PI (0 frais), libère l'escrow, passe en CANCELLED,
   * et notifie les deux parties. Renvoie le nombre d'UGC expirés.
   */
  async expireOverdueUgcs(): Promise<number> {
    const now = new Date();
    const overdue = await this.prisma.uGC.findMany({
      where: { status: UGCStatus.REQUESTED, deadline: { lt: now } },
      include: UGC_INCLUDE,
    });

    let count = 0;
    for (const ugc of overdue) {
      try {
        if (ugc.stripePaymentIntentId) {
          // Annule le PI + libère l'escrow (idempotent)
          await this.cancelUgcPaymentIntent(ugc.stripePaymentIntentId, ugc.id);
        }
        await this.prisma.uGC.update({
          where: { id: ugc.id },
          data: {
            status: UGCStatus.CANCELLED,
            cancelledAt: now,
            cancellationReason: 'Deadline dépassée — demande expirée automatiquement',
          },
        });

        for (const party of [ugc.requester, ugc.submitter]) {
          await this.notifyUgc(
            party,
            'ugc_expired',
            { ugcType: ugc.type },
            NotificationType.UGC_CANCELLED,
            ugc.id,
          );
        }

        await this.auditService.log(ugc.requestedBy, AuditCategory.SESSION, 'UGC_EXPIRED', { ugcId: ugc.id });
        count += 1;
      } catch (error) {
        this.logger.error(`Failed to expire UGC ${ugc.id}: ${error.message}`);
      }
    }

    if (count > 0) this.logger.log(`Expired ${count} overdue UGC request(s)`);
    return count;
  }

  /**
   * Rappel J-1 aux testeurs pour les UGC REQUESTED dont la deadline tombe dans
   * les prochaines 24h. Renvoie le nombre de rappels envoyés.
   */
  async sendUgcDeadlineReminders(): Promise<number> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const soon = await this.prisma.uGC.findMany({
      where: { status: UGCStatus.REQUESTED, deadline: { gte: now, lt: in24h } },
      include: UGC_INCLUDE,
    });

    let count = 0;
    for (const ugc of soon) {
      if (!ugc.submitter?.email || !ugc.deadline) continue;
      await this.notifyUgc(
        ugc.submitter,
        'ugc_reminder',
        { ugcType: ugc.type, deadline: ugc.deadline.toLocaleDateString('fr-FR') },
        NotificationType.UGC_REQUESTED,
        ugc.id,
      );
      count += 1;
    }

    if (count > 0) this.logger.log(`Sent ${count} UGC deadline reminder(s)`);
    return count;
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

  /**
   * Envoie un email UGC traduit dans la langue préférée du destinataire (P2.3).
   * Réutilise le helper i18n du service de notifications.
   */
  private async notifyUgc(
    recipient: { id: string; email: string | null; firstName: string | null } | null | undefined,
    key: string,
    args: Record<string, any>,
    notifType: NotificationType,
    ugcId: string,
  ) {
    if (!recipient?.email) return;
    const { title, message } = await this.notificationsService.getTranslatedNotification(
      recipient.id,
      key,
      args,
    );
    this.notificationsService.tryQueueEmail({
      to: recipient.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: title,
      variables: { firstName: recipient.firstName || '', message, ...args },
      metadata: { ugcId, type: notifType },
    });
  }

  private async notifyDispute(ugc: any, _escalatedBy: string) {
    // Notifier les deux parties (dans leur langue)
    for (const party of [ugc.requester, ugc.submitter]) {
      await this.notifyUgc(
        party,
        'ugc_disputed',
        { ugcType: ugc.type },
        NotificationType.UGC_DISPUTED,
        ugc.id,
      );
    }

    // Notifier tous les admins
    const admins = await this.prisma.profile.findMany({ where: { role: UserRole.ADMIN } });
    for (const admin of admins) {
      await this.notifyUgc(
        admin,
        'ugc_admin_dispute',
        { ugcType: ugc.type },
        NotificationType.UGC_DISPUTED,
        ugc.id,
      );
    }
  }
}
