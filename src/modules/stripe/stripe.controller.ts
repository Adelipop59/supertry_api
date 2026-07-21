import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { StripeService } from './stripe.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WebhookHandlersService } from './handlers/webhook-handlers.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { UserRole, AuditCategory, StripeWebhookStatus } from '@prisma/client';
import { CreateConnectAccountDto } from './dto/create-connect-account.dto';
import { CreateOnboardingLinkDto } from './dto/create-onboarding-link.dto';
import { KycStatusResponseDto, KycRequiredResponseDto } from './dto/kyc-status-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { Param } from '@nestjs/common';

@ApiTags('Stripe')
@Controller('stripe')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  /**
   * Nombre de tentatives de traitement au-delà duquel on cesse de demander à Stripe de
   * retenter (l'event reste en FAILED, donc rejouable manuellement). Évite qu'un event
   * "poison" déclenche des retries pendant 3 jours.
   */
  private static readonly MAX_WEBHOOK_ATTEMPTS = 5;

  constructor(
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly webhookHandlers: WebhookHandlersService,
    private readonly paymentReconciliation: PaymentReconciliationService,
  ) {}

  // ============================================================================
  // Stripe Connect Routes
  // ============================================================================

  @Post('connect/create')
  @ApiOperation({ summary: 'Créer un compte Connect Stripe pour un testeur' })
  @ApiResponse({ status: 201, description: 'Compte Connect créé avec succès' })
  @ApiResponse({ status: 400, description: 'Profil non trouvé ou compte déjà existant' })
  @Roles(UserRole.USER)  // ONLY TESTERS need Stripe Connect to receive transfers
  @HttpCode(HttpStatus.CREATED)
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async createConnectAccount(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateConnectAccountDto,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new I18nHttpException('auth.profile_not_found', 'PROFILE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Check if Connect account already exists
    if (profile.stripeConnectAccountId) {
      return {
        accountId: profile.stripeConnectAccountId,
        message: 'Votre compte de paiement est déjà configuré.',
      };
    }

    // SÉCURITÉ KYC : l'email et le pays sont dérivés du profil serveur authentifié,
    // PAS du DTO client. Le pays détermine la juridiction KYC et la devise de payout ;
    // l'accepter du client permettrait de rattacher le compte de paiement à une identité
    // ou une juridiction incohérente. Le DTO ne sert qu'au `type` (express/standard).
    const accountEmail = profile.email;
    const accountCountry = (profile.country || 'FR').toUpperCase();

    const account = await this.stripeService.createConnectAccount(
      accountEmail,
      accountCountry,
      createDto.type,
      {},
      {
        firstName: profile.firstName || undefined,
        lastName: profile.lastName || undefined,
        phone: profile.phone || undefined,
        dateOfBirth: profile.birthDate?.toISOString().split('T')[0],
      },
    );

    // Save to profile
    await this.prisma.profile.update({
      where: { id: userId },
      data: {
        stripeConnectAccountId: account.id,
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      AuditCategory.USER,
      'STRIPE_CONNECT_ACCOUNT_CREATED',
      {
        stripeAccountId: account.id,
        country: accountCountry,
        type: createDto.type,
      },
    );

    this.logger.log(`Connect account created for user ${userId}: ${account.id}`);

    return {
      accountId: account.id,
      message: 'Compte de paiement créé avec succès.',
    };
  }

  @Post('connect/onboarding-link')
  @ApiOperation({ summary: "Obtenir le lien d'onboarding Stripe Connect" })
  @ApiResponse({ status: 200, description: "Lien d'onboarding généré avec succès" })
  @ApiResponse({ status: 400, description: 'Aucun compte Connect trouvé' })
  @Roles(UserRole.USER)  // ONLY TESTERS
  @HttpCode(HttpStatus.OK)
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async createOnboardingLink(
    @CurrentUser('id') userId: string,
    @Body() onboardingDto: CreateOnboardingLinkDto,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.BAD_REQUEST);
    }

    const url = await this.stripeService.createAccountLink(
      profile.stripeConnectAccountId,
      onboardingDto.type || ('account_onboarding' as const),
      onboardingDto.refreshUrl,
      onboardingDto.returnUrl,
    );

    return { url };
  }

  @Get('connect/account')
  @ApiOperation({ summary: 'Récupérer les informations du compte Connect Stripe' })
  @ApiResponse({ status: 200, description: 'Informations du compte récupérées' })
  @ApiResponse({ status: 400, description: 'Aucun compte Connect trouvé' })
  @Roles(UserRole.USER)  // ONLY TESTERS
  @ApiAuthResponses()
  async getConnectAccount(@CurrentUser('id') userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.BAD_REQUEST);
    }

    const account = await this.stripeService.getConnectAccount(profile.stripeConnectAccountId);

    return {
      id: account.id,
      email: account.email,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      country: account.country,
    };
  }

  @Get('connect/kyc-status')
  @ApiOperation({ summary: 'Vérifier le statut KYC du compte Connect Stripe' })
  @ApiResponse({ status: 200, description: 'Statut KYC récupéré', type: KycStatusResponseDto })
  @Roles(UserRole.USER)  // ONLY TESTERS
  @ApiAuthResponses()
  async getKycStatus(
    @CurrentUser('id') userId: string,
  ): Promise<KycStatusResponseDto | KycRequiredResponseDto> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true, stripeOnboardingCompleted: true },
    });

    if (!profile?.stripeConnectAccountId) {
      return {
        kycRequired: true,
        accountExists: false,
        message: 'Veuillez configurer votre compte de paiement.',
      };
    }

    const kycStatus = await this.stripeService.getKycStatus(profile.stripeConnectAccountId);

    // Sync DB si Stripe confirme onboarding complété mais DB pas encore à jour
    // (cas où le webhook account.updated n'est pas encore arrivé)
    if (!profile.stripeOnboardingCompleted && kycStatus.chargesEnabled && kycStatus.detailsSubmitted) {
      await this.prisma.profile.update({
        where: { id: userId },
        data: { stripeOnboardingCompleted: true },
      });
      this.logger.log(`Synced stripeOnboardingCompleted=true for user ${userId} (from kyc-status check)`);
    }

    return kycStatus;
  }

  @Post('connect/account-session')
  @ApiOperation({ summary: 'Créer une AccountSession pour les composants embarqués Connect (mobile)' })
  @ApiResponse({ status: 200, description: 'AccountSession créée avec clientSecret' })
  @ApiResponse({ status: 400, description: 'Aucun compte Connect trouvé' })
  @Roles(UserRole.USER)
  @HttpCode(HttpStatus.OK)
  @ApiAuthResponses()
  async createAccountSession(@CurrentUser('id') userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.BAD_REQUEST);
    }

    return this.stripeService.createAccountSession(profile.stripeConnectAccountId);
  }

  @Get('connect/onboarding-status')
  @ApiOperation({ summary: 'Récupérer le statut détaillé d\'onboarding Connect + Identity (mobile)' })
  @ApiResponse({ status: 200, description: 'Statut détaillé récupéré' })
  @Roles(UserRole.USER)
  @ApiAuthResponses()
  async getOnboardingStatus(@CurrentUser('id') userId: string) {
    return this.stripeService.getDetailedOnboardingStatus(userId);
  }

  @Get('connect/balance')
  @ApiOperation({ summary: 'Récupérer le solde du compte Connect Stripe' })
  @ApiResponse({ status: 200, description: 'Solde récupéré avec succès' })
  @ApiResponse({ status: 400, description: 'Aucun compte Connect trouvé' })
  @Roles(UserRole.USER)  // ONLY TESTERS
  @ApiAuthResponses()
  async getConnectBalance(@CurrentUser('id') userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('stripe.no_account', 'STRIPE_NO_ACCOUNT', HttpStatus.BAD_REQUEST);
    }

    const balance = await this.stripeService.getConnectAccountBalance(
      profile.stripeConnectAccountId,
    );

    return {
      available: balance.available,
      pending: balance.pending,
      currency: balance.available[0]?.currency || 'eur',
    };
  }

  // ============================================================================
  // Stripe Identity (TESTEUR KYC)
  // ============================================================================

  @Post('identity/create-session')
  @ApiOperation({ summary: "Créer une session de vérification d'identité Stripe Identity" })
  @ApiResponse({ status: 201, description: 'Session de vérification créée' })
  @ApiResponse({ status: 400, description: 'Compte Connect requis au préalable' })
  @Roles(UserRole.USER)
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async createIdentitySession(
    @CurrentUser('id') userId: string,
    @Body() dto: { returnUrl: string },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('stripe.identity_create_account_first', 'STRIPE_CREATE_ACCOUNT_FIRST', HttpStatus.BAD_REQUEST);
    }

    return this.stripeService.createIdentityVerificationSession(profile.id, dto.returnUrl);
  }

  @Get('identity/status/:sessionId')
  @ApiOperation({ summary: "Récupérer le statut d'une session de vérification d'identité" })
  @ApiResponse({ status: 200, description: 'Statut de la vérification récupéré' })
  @Roles(UserRole.USER, UserRole.PRO)
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getIdentityStatus(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    // SÉCURITÉ (anti-IDOR) : on ne renvoie le statut que si la session d'identité
    // appartient bien à l'utilisateur authentifié. Sans ce contrôle, n'importe quel
    // utilisateur pourrait lire le statut KYC (et les erreurs) d'un tiers en devinant
    // un identifiant de session Stripe Identity.
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeIdentitySessionId: true },
    });

    if (!profile?.stripeIdentitySessionId || profile.stripeIdentitySessionId !== sessionId) {
      throw new I18nHttpException('stripe.identity_session_not_found', 'STRIPE_IDENTITY_SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    return this.stripeService.getIdentityVerificationStatus(sessionId);
  }

  @Post('identity/create-session-mobile')
  @ApiOperation({ summary: "Créer une session Identity pour le SDK mobile natif (pas de returnUrl)" })
  @ApiResponse({ status: 201, description: 'Session Identity mobile créée avec clientSecret' })
  @ApiResponse({ status: 400, description: 'Compte Connect requis au préalable' })
  @Roles(UserRole.USER)
  @ApiAuthResponses()
  async createIdentitySessionMobile(@CurrentUser('id') userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('stripe.identity_create_account_first', 'STRIPE_CREATE_ACCOUNT_FIRST', HttpStatus.BAD_REQUEST);
    }

    // Le SDK mobile natif ne nécessite pas de returnUrl — on passe une URL factice
    const result = await this.stripeService.createIdentityVerificationSession(
      profile.id,
      'supertry://identity-callback',
    );

    // Sauvegarder le sessionId et le statut en BDD
    await this.prisma.profile.update({
      where: { id: userId },
      data: {
        stripeIdentitySessionId: result.sessionId,
        stripeIdentityStatus: 'NOT_STARTED',
      },
    });

    return {
      clientSecret: result.clientSecret,
      sessionId: result.sessionId,
    };
  }

  // ============================================================================
  // Payouts (Retraits IBAN)
  // ============================================================================
  //
  // ⚠️ SÉCURITÉ : l'ancien endpoint POST /stripe/payouts/create a été SUPPRIMÉ.
  // Il créait un payout directement à partir d'un montant et d'un withdrawalId
  // fournis par le client, SANS débiter le wallet ni vérifier l'identité (KYC),
  // ce qui permettait un vidage de fonds. Le seul chemin de retrait autorisé est
  // désormais POST /withdrawals → WithdrawalsService.createWithdrawal(), qui pose
  // un verrou pessimiste sur le wallet, vérifie l'onboarding + l'identité et
  // débite le solde de façon atomique avant de déclencher le payout.

  // ============================================================================
  // Stripe Webhooks
  // ============================================================================

  @Post('webhooks')
  @ApiOperation({ summary: 'Webhook Stripe - Réception des événements Stripe' })
  @ApiResponse({ status: 200, description: 'Événement webhook traité avec succès' })
  @ApiResponse({ status: 400, description: 'Signature stripe-signature manquante ou invalide' })
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    if (!signature) {
      throw new I18nHttpException('stripe.webhook_invalid', 'STRIPE_WEBHOOK_INVALID', HttpStatus.BAD_REQUEST);
    }

    const event = this.stripeService.constructEvent((req as any).rawBody, signature);

    this.logger.log(`Webhook received: ${event.type} - ${event.id}`);

    // ── Déduplication + fiabilité (SEC-S3) ───────────────────────────────────
    // Stripe livre les events "au moins une fois". On réclame l'event de façon
    // ATOMIQUE via la PK (race-safe) :
    //   • ligne absente          → INSERT en PROCESSING, on traite.
    //   • ligne en FAILED        → on la reprend (PROCESSING, attempts+1), on retraite.
    //   • ligne PROCESSED/PROCESSING → 0 ligne retournée → doublon, on ignore (200).
    //
    // AVANT : la ligne était insérée puis TOUTE erreur du handler était avalée avec un
    // 200 renvoyé à Stripe. Un handler financier en échec perdait donc l'événement
    // DÉFINITIVEMENT (aucun retry Stripe, et la dédup bloquait tout rejeu manuel).
    // Désormais l'event n'est marqué PROCESSED qu'APRÈS succès du handler, et un échec
    // renvoie 500 pour que Stripe retente (backoff automatique).
    const claimed = await this.prisma.$queryRaw<{ attempts: number }[]>`
      INSERT INTO stripe_webhook_events (id, type, status, attempts, received_at)
      VALUES (${event.id}, ${event.type}, 'PROCESSING'::"StripeWebhookStatus", 1, NOW())
      ON CONFLICT (id) DO UPDATE
        SET status = 'PROCESSING'::"StripeWebhookStatus",
            attempts = stripe_webhook_events.attempts + 1,
            received_at = NOW()
        WHERE stripe_webhook_events.status = 'FAILED'::"StripeWebhookStatus"
      RETURNING attempts
    `;

    if (claimed.length === 0) {
      this.logger.warn(`Webhook ${event.id} (${event.type}) déjà traité/en cours — ignoré (doublon Stripe).`);
      return { received: true, duplicate: true };
    }

    const attempts = claimed[0].attempts;

    // Audit webhook
    await this.auditService.log(
      null, // System event
      AuditCategory.SYSTEM,
      `STRIPE_WEBHOOK_${event.type.toUpperCase().replace(/\./g, '_')}`,
      {
        eventId: event.id,
        eventType: event.type,
      },
    );

    try {
      switch (event.type) {
        // ===== Account webhooks (Onboarding PRO) =====
        case 'account.updated':
          await this.webhookHandlers.handleAccountUpdated(event.data.object);
          break;
        case 'account.external_account.created':
          await this.webhookHandlers.handleAccountExternalAccountCreated(event);
          break;
        case 'account.external_account.deleted':
          await this.webhookHandlers.handleAccountExternalAccountDeleted(event);
          break;
        case 'capability.updated':
          await this.webhookHandlers.handleCapabilityUpdated(event, event.data.object);
          break;

        // ===== Identity webhooks (TESTEUR KYC) =====
        case 'identity.verification_session.created':
          await this.webhookHandlers.handleIdentitySessionCreated(event.data.object);
          break;
        case 'identity.verification_session.processing':
          await this.webhookHandlers.handleIdentitySessionProcessing(event.data.object);
          break;
        case 'identity.verification_session.verified':
          await this.webhookHandlers.handleIdentitySessionVerified(event.data.object);
          break;
        case 'identity.verification_session.requires_input':
          await this.webhookHandlers.handleIdentitySessionRequiresInput(event.data.object);
          break;
        case 'identity.verification_session.canceled':
          await this.webhookHandlers.handleIdentitySessionCanceled(event.data.object);
          break;
        case 'identity.verification_session.redacted':
          await this.webhookHandlers.handleIdentitySessionRedacted(event.data.object);
          break;

        // ===== Payment Intent webhooks =====
        case 'payment_intent.created':
          await this.webhookHandlers.handlePaymentIntentCreated(event.data.object);
          break;
        case 'payment_intent.processing':
          await this.webhookHandlers.handlePaymentIntentProcessing(event.data.object);
          break;
        case 'payment_intent.succeeded':
          await this.webhookHandlers.handlePaymentIntentSucceeded(event.data.object);
          break;
        case 'payment_intent.payment_failed':
          await this.webhookHandlers.handlePaymentIntentPaymentFailed(event.data.object);
          break;
        case 'payment_intent.canceled':
          await this.webhookHandlers.handlePaymentIntentCanceled(event.data.object);
          break;
        case 'payment_intent.amount_capturable_updated':
          await this.webhookHandlers.handlePaymentIntentAmountCapturableUpdated(event.data.object);
          break;

        // ===== Transfer webhooks =====
        case 'transfer.created':
          await this.webhookHandlers.handleTransferCreated(event.data.object);
          break;
        case 'transfer.updated':
          await this.webhookHandlers.handleTransferUpdated(event.data.object);
          break;
        case 'transfer.reversed':
          await this.webhookHandlers.handleTransferReversed(event.data.object);
          break;

        // ===== Refund webhooks =====
        case 'charge.refunded':
          await this.webhookHandlers.handleChargeRefunded(event.data.object);
          break;
        case 'refund.created':
          await this.webhookHandlers.handleRefundCreated(event.data.object);
          break;
        case 'refund.updated':
          await this.webhookHandlers.handleRefundUpdated(event.data.object);
          break;
        case 'refund.failed':
          await this.webhookHandlers.handleRefundFailed(event.data.object);
          break;

        // ===== Payout webhooks (Retraits IBAN) =====
        case 'payout.created':
          await this.webhookHandlers.handlePayoutCreated(event.data.object, event);
          break;
        case 'payout.paid':
          await this.webhookHandlers.handlePayoutPaid(event.data.object);
          break;
        case 'payout.failed':
          await this.webhookHandlers.handlePayoutFailed(event.data.object);
          break;
        case 'payout.canceled':
          await this.webhookHandlers.handlePayoutCanceled(event.data.object);
          break;
        case 'payout.updated':
          await this.webhookHandlers.handlePayoutUpdated(event.data.object);
          break;

        // ===== Checkout Session (garde l'existant) =====
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event);
          break;

        default:
          this.logger.log(`Unhandled webhook event type: ${event.type}`);
      }

      // Succès : l'event est définitivement consommé (les rejeux seront ignorés).
      await this.prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: StripeWebhookStatus.PROCESSED,
          processedAt: new Date(),
          lastError: null,
        },
      });

      return { received: true };
    } catch (error) {
      this.logger.error(
        `Error handling webhook ${event.type} (${event.id}, tentative ${attempts}): ${error.message}`,
        error.stack,
      );

      // Échec : on marque l'event REJOUABLE (FAILED) — il ne sera pas dédupliqué.
      await this.prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: StripeWebhookStatus.FAILED,
          lastError: String(error?.message ?? 'unknown').slice(0, 500),
        },
      });

      await this.auditService.log(null, AuditCategory.SYSTEM, 'STRIPE_WEBHOOK_FAILED', {
        eventId: event.id,
        eventType: event.type,
        attempts,
        error: error?.message,
      });

      // Au-delà du plafond, on cesse de solliciter Stripe (évite une tempête de retries
      // sur un event "poison") : on répond 200 et l'event reste en FAILED, donc rejouable
      // manuellement. En dessous, on renvoie 500 pour que Stripe retente automatiquement.
      if (attempts >= StripeController.MAX_WEBHOOK_ATTEMPTS) {
        this.logger.error(
          `⚠️  Webhook ${event.id} (${event.type}) en échec après ${attempts} tentatives — ` +
            `abandon des retries Stripe. Event conservé en FAILED pour rejeu manuel.`,
        );
        return { received: true, failed: true, replayable: true };
      }

      throw new I18nHttpException(
        'stripe.webhook_processing_failed',
        'STRIPE_WEBHOOK_PROCESSING_FAILED',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ============================================================================
  // Private Webhook Handlers (garde seulement checkout.session.completed)
  // ============================================================================

  private async handleCheckoutSessionCompleted(event: any) {
    const session = event.data.object;
    this.logger.log(`Checkout Session completed: ${session.id} (PI: ${session.payment_intent})`);

    // Logique partagée et idempotente (webhook / endpoint reconcile / scheduler)
    await this.paymentReconciliation.reconcileCheckoutSession(session.id, 'webhook');
  }

  // Autres handlers déplacés dans WebhookHandlersService pour meilleure organisation
}
