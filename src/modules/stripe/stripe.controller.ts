import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { StripeService } from './stripe.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { WebhookHandlersService } from './handlers/webhook-handlers.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import { UserRole, AuditCategory, NotificationType } from '@prisma/client';
import { CreateConnectAccountDto } from './dto/create-connect-account.dto';
import { CreateOnboardingLinkDto } from './dto/create-onboarding-link.dto';
import { KycStatusResponseDto, KycRequiredResponseDto } from './dto/kyc-status-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Param } from '@nestjs/common';

@Controller('stripe')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly webhookHandlers: WebhookHandlersService,
  ) {}

  // ============================================================================
  // Stripe Connect Routes
  // ============================================================================

  @Post('connect/create')
  @Roles(UserRole.USER)  // ONLY TESTERS need Stripe Connect to receive transfers
  @HttpCode(HttpStatus.CREATED)
  async createConnectAccount(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateConnectAccountDto,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new BadRequestException('Profile not found');
    }

    // Check if Connect account already exists
    if (profile.stripeConnectAccountId) {
      return {
        accountId: profile.stripeConnectAccountId,
        message: 'Connect account already exists',
      };
    }

    // Create Stripe Connect account
    const account = await this.stripeService.createConnectAccount(
      createDto.email,
      createDto.country,
      createDto.type,
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
        country: createDto.country,
        type: createDto.type,
      },
    );

    this.logger.log(`Connect account created for user ${userId}: ${account.id}`);

    return {
      accountId: account.id,
      message: 'Connect account created successfully',
    };
  }

  @Post('connect/onboarding-link')
  @Roles(UserRole.USER)  // ONLY TESTERS
  @HttpCode(HttpStatus.OK)
  async createOnboardingLink(
    @CurrentUser('id') userId: string,
    @Body() onboardingDto: CreateOnboardingLinkDto,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new BadRequestException('No Stripe Connect account found');
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
  @Roles(UserRole.USER)  // ONLY TESTERS
  async getConnectAccount(@CurrentUser('id') userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new BadRequestException('No Stripe Connect account found');
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
  @Roles(UserRole.USER)  // ONLY TESTERS
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
        message: 'Create Stripe Connect account first',
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

  @Get('connect/balance')
  @Roles(UserRole.USER)  // ONLY TESTERS
  async getConnectBalance(@CurrentUser('id') userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new BadRequestException('No Stripe Connect account found');
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
  @Roles(UserRole.USER)
  async createIdentitySession(
    @CurrentUser('id') userId: string,
    @Body() dto: { returnUrl: string },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new BadRequestException('Create Stripe Connect account first');
    }

    return this.stripeService.createIdentityVerificationSession(profile.id, dto.returnUrl);
  }

  @Get('identity/status/:sessionId')
  @Roles(UserRole.USER, UserRole.PRO)
  async getIdentityStatus(@Param('sessionId') sessionId: string) {
    return this.stripeService.getIdentityVerificationStatus(sessionId);
  }

  // ============================================================================
  // Payouts (Retraits IBAN)
  // ============================================================================

  @Post('payouts/create')
  @Roles(UserRole.USER)  // ONLY TESTERS
  async createPayout(
    @CurrentUser('id') userId: string,
    @Body() dto: { amount: number; withdrawalId: string },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new BadRequestException('No Stripe Connect account');
    }

    return this.stripeService.createPayout(dto.amount, profile.stripeConnectAccountId, 'eur', {
      withdrawalId: dto.withdrawalId,
    });
  }

  // ============================================================================
  // Stripe Webhooks
  // ============================================================================

  @Post('webhooks')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const event = this.stripeService.constructEvent((req as any).rawBody, signature);

    this.logger.log(`Webhook received: ${event.type} - ${event.id}`);

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
    } catch (error) {
      this.logger.error(`Error handling webhook ${event.type}: ${error.message}`, error.stack);
      // Don't throw - return 200 to Stripe to avoid retries
    }

    return { received: true };
  }

  // ============================================================================
  // Private Webhook Handlers (garde seulement checkout.session.completed)
  // ============================================================================

  private async handleCheckoutSessionCompleted(event: any) {
    const session = event.data.object;
    const paymentIntentId = session.payment_intent as string;
    this.logger.log(`Checkout Session completed: ${session.id} (PI: ${paymentIntentId})`);

    // Find transaction by stripeSessionId
    const transaction = await this.prisma.transaction.findUnique({
      where: { stripeSessionId: session.id },
    });

    if (!transaction) {
      this.logger.warn(`Transaction not found for session ${session.id}`);
      return;
    }

    if (!transaction.campaignId) {
      this.logger.warn(`Transaction ${transaction.id} has no campaignId`);
      return;
    }

    // Find campaign
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: transaction.campaignId },
    });

    if (!campaign) {
      this.logger.warn(`Campaign ${transaction.campaignId} not found`);
      return;
    }

    // Vérifier le statut du PaymentIntent pour déterminer manual capture vs automatic
    const paymentStatus = session.payment_status; // 'paid' = auto capture, 'unpaid' = manual capture pending

    // Avec manual capture, le checkout est "completed" mais le PI est en requires_capture
    // On doit vérifier le PI pour savoir si c'est auto ou manual
    const isManualCapture = session.payment_intent && paymentStatus === 'paid';
    // Note: Stripe marque toujours payment_status='paid' même en manual capture quand l'auth réussit

    // Sauvegarder le PaymentIntent ID sur la campagne dans tous les cas
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        stripePaymentIntentId: paymentIntentId,
      },
    });

    // Vérifier si le PI est en requires_capture (manual capture)
    let piStatus: string | undefined;
    try {
      const pi = await this.stripeService.getPaymentIntent(paymentIntentId);
      piStatus = pi.status;
    } catch {
      this.logger.warn(`Could not retrieve PI ${paymentIntentId}, assuming succeeded`);
      piStatus = 'succeeded';
    }

    if (piStatus === 'requires_capture') {
      // MANUAL CAPTURE: Paiement autorisé mais pas encore capturé
      // Le PRO peut annuler dans 1h sans frais
      this.logger.log(`━━━ MANUAL CAPTURE: PI ${paymentIntentId} requires_capture ━━━`);

      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'PENDING_PAYMENT' as any,
          stripePaymentIntentId: paymentIntentId,
          paymentAuthorizedAt: new Date(),
        },
      });

      // Transaction reste PENDING (sera COMPLETED après capture)
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'PENDING' as any },
      });

      // Notification: paiement autorisé, campagne sera active après 1h
      const sellerProfile = await this.prisma.profile.findUnique({
        where: { id: campaign.sellerId },
        select: { email: true, firstName: true },
      });

      if (sellerProfile) {
        await this.notificationsService.queueEmail({
          to: sellerProfile.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Payment Authorized - Campaign Pending',
          variables: {
            campaignTitle: campaign.title,
            message: `Your payment for "${campaign.title}" has been authorized. You have 1 hour to cancel for free. After that, the campaign will be activated automatically.`,
          },
          metadata: {
            userId: campaign.sellerId,
            campaignId: campaign.id,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }

      await this.auditService.log(
        campaign.sellerId,
        AuditCategory.CAMPAIGN,
        'CAMPAIGN_PAYMENT_AUTHORIZED',
        {
          campaignId: campaign.id,
          paymentIntentId,
          captureMethod: 'manual',
          gracePeriodMinutes: 60,
        },
      );

      this.logger.log(`Campaign ${campaign.id} payment authorized (manual capture, 1h grace period)`);
    } else {
      // AUTOMATIC CAPTURE: Paiement déjà capturé (succeeded)
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'COMPLETED' as any },
      });

      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'ACTIVE' as any,
          stripePaymentIntentId: paymentIntentId,
          paymentCapturedAt: new Date(),
        },
      });

      // Update PlatformWallet escrow
      const platformWallet = await this.prisma.platformWallet.findFirst();
      if (platformWallet) {
        await this.prisma.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { increment: Number(transaction.amount) },
            totalReceived: { increment: Number(transaction.amount) },
          },
        });
      }

      const sellerProfile = await this.prisma.profile.findUnique({
        where: { id: campaign.sellerId },
        select: { email: true, firstName: true },
      });

      await this.auditService.log(
        campaign.sellerId,
        AuditCategory.CAMPAIGN,
        'CAMPAIGN_ACTIVATED',
        {
          campaignId: campaign.id,
          transactionId: transaction.id,
          sessionId: session.id,
          paymentIntentId,
          amount: transaction.amount,
        },
      );

      if (sellerProfile) {
        await this.notificationsService.queueEmail({
          to: sellerProfile.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Campaign Activated',
          variables: {
            campaignTitle: campaign.title,
            message: `Your campaign "${campaign.title}" has been activated and is now live!`,
          },
          metadata: {
            userId: campaign.sellerId,
            campaignId: campaign.id,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }

      this.logger.log(`Campaign ${campaign.id} activated via Checkout Session ${session.id}`);
    }
  }

  // Autres handlers déplacés dans WebhookHandlersService pour meilleure organisation
}
