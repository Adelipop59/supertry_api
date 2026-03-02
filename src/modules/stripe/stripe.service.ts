import { Injectable, Logger, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { KycStatusResponseDto } from './dto/kyc-status-response.dto';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    });

    this.logger.log('Stripe SDK initialized');
  }

  // ============================================================================
  // Stripe Connect
  // ============================================================================

  async createConnectAccount(
    email: string,
    country: string,
    type: 'express' | 'standard' = 'express',
    metadata: Record<string, string> = {},
    individual?: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      dateOfBirth?: string; // ISO format: 'YYYY-MM-DD'
    },
  ): Promise<Stripe.Account> {
    try {
      const accountParams: Stripe.AccountCreateParams = {
        type,
        country,
        email,
        business_type: 'individual',
        business_profile: {
          url: 'https://www.super-try.com',
        },
        individual: {
          email,
          ...(individual?.firstName && { first_name: individual.firstName }),
          ...(individual?.lastName && { last_name: individual.lastName }),
          ...(individual?.phone && { phone: individual.phone }),
          ...(individual?.dateOfBirth && (() => {
            const d = new Date(individual.dateOfBirth!);
            if (isNaN(d.getTime())) return {};
            return { dob: { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() } };
          })()),
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          platform: 'supertry',
          env: process.env.NODE_ENV || 'development',
          ...metadata,
        },
        settings: {
          payouts: {
            schedule: {
              interval: 'manual', // ✅ CRITIQUE: Bloquer payouts automatiques pour "Separate Charges and Transfers"
            },
          },
        },
      };

      const account = await this.stripe.accounts.create(accountParams);

      this.logger.log(`Connect account created: ${account.id} for ${email} (manual payouts)`);
      return account;
    } catch (error) {
      this.logger.error(`Failed to create Connect account: ${error.message}`, error.stack);
      throw new BadRequestException(error.message || 'Failed to create Stripe Connect account');
    }
  }

  async createAccountLink(
    accountId: string,
    type: 'account_onboarding' | 'account_update',
    refreshUrl: string,
    returnUrl: string,
  ): Promise<string> {
    try {
      const accountLink = await this.stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type,
      });

      this.logger.log(`Account link created for ${accountId}: ${type}`);
      return accountLink.url;
    } catch (error) {
      this.logger.error(`Failed to create account link: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create onboarding link');
    }
  }

  async getConnectAccount(accountId: string): Promise<Stripe.Account> {
    try {
      return await this.stripe.accounts.retrieve(accountId);
    } catch (error) {
      this.logger.error(`Failed to retrieve account ${accountId}: ${error.message}`, error.stack);
      throw new NotFoundException('Stripe Connect account not found');
    }
  }

  async getConnectAccountBalance(accountId: string): Promise<Stripe.Balance> {
    try {
      return await this.stripe.balance.retrieve({
        stripeAccount: accountId,
      });
    } catch (error) {
      this.logger.error(`Failed to retrieve balance for ${accountId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve account balance');
    }
  }

  async getConnectBalanceTransactions(
    accountId: string,
    params: { limit?: number } = {},
  ): Promise<Stripe.ApiList<Stripe.BalanceTransaction>> {
    try {
      return await this.stripe.balanceTransactions.list(
        { limit: params.limit || 10 },
        { stripeAccount: accountId },
      );
    } catch (error) {
      this.logger.error(`Failed to list balance transactions for ${accountId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to list balance transactions');
    }
  }

  async getKycStatus(accountId: string): Promise<KycStatusResponseDto> {
    try {
      const account = await this.stripe.accounts.retrieve(accountId);

      return {
        chargesEnabled: account.charges_enabled || false,
        payoutsEnabled: account.payouts_enabled || false,
        detailsSubmitted: account.details_submitted || false,
        requirements: {
          currentlyDue: account.requirements?.currently_due || [],
          pastDue: account.requirements?.past_due || [],
          eventuallyDue: account.requirements?.eventually_due || [],
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get KYC status for ${accountId}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve KYC status');
    }
  }

  // ============================================================================
  // Account Sessions (for mobile embedded onboarding)
  // ============================================================================

  async createAccountSession(accountId: string): Promise<{ clientSecret: string }> {
    try {
      const accountSession = await this.stripe.accountSessions.create({
        account: accountId,
        components: {
          account_onboarding: { enabled: true },
        },
      });

      this.logger.log(`AccountSession created for ${accountId}`);
      return { clientSecret: accountSession.client_secret };
    } catch (error) {
      this.logger.error(`Failed to create AccountSession: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create account session');
    }
  }

  // ============================================================================
  // Detailed Onboarding Status (for mobile app)
  // ============================================================================

  computeOnboardingStatus(account: Stripe.Account): string {
    const disabledReason = account.requirements?.disabled_reason ?? null;
    const currentlyDue = account.requirements?.currently_due ?? [];
    const pastDue = account.requirements?.past_due ?? [];
    const pendingVerification = account.requirements?.pending_verification ?? [];

    if (disabledReason?.includes('rejected')) return 'REJECTED';
    if (disabledReason === 'platform_paused') return 'RESTRICTED';
    if (pastDue.length > 0) return 'PAST_DUE';
    if (account.charges_enabled && account.payouts_enabled) return 'COMPLETED';
    if (pendingVerification.length > 0 && currentlyDue.length === 0) return 'PENDING_VERIFICATION';
    if (currentlyDue.length > 0 && account.details_submitted) return 'ACTION_REQUIRED';
    if (!account.details_submitted) return 'IN_PROGRESS';
    return 'IN_PROGRESS';
  }

  async getDetailedOnboardingStatus(profileId: string): Promise<any> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        stripeConnectAccountId: true,
        stripeOnboardingCompleted: true,
        stripeIdentityVerified: true,
        stripeIdentityStatus: true,
        stripeIdentityLastError: true,
        stripeIdentitySessionId: true,
        completedSessionsCount: true,
      },
    });

    if (!profile?.stripeConnectAccountId) {
      // Compute identity status
      const identityRequired = (profile?.completedSessionsCount ?? 0) >= 3;
      return {
        status: 'NOT_STARTED',
        accountExists: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        disabledReason: null,
        requirements: {
          currentlyDue: [],
          pastDue: [],
          pendingVerification: [],
          eventuallyDue: [],
          currentDeadline: null,
          errors: [],
        },
        identity: {
          status: identityRequired ? 'NOT_STARTED' : 'NOT_REQUIRED',
          required: identityRequired,
          verified: false,
          lastError: null,
          lastErrorMessage: null,
          sessionId: null,
        },
        canApplyToCampaigns: false,
        canReceivePayments: false,
        userMessage: 'Configurez votre compte pour recevoir vos paiements.',
      };
    }

    // Fetch real-time status from Stripe
    const account = await this.stripe.accounts.retrieve(profile.stripeConnectAccountId);
    const status = this.computeOnboardingStatus(account);

    // Sync to DB
    await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        stripeOnboardingCompleted: account.charges_enabled && account.details_submitted,
        stripeOnboardingStatus: status,
        stripeDisabledReason: account.requirements?.disabled_reason ?? null,
        stripeRequirementsCurrentlyDue: account.requirements?.currently_due ?? [],
        stripeRequirementsPastDue: account.requirements?.past_due ?? [],
        stripeRequirementsPendingVerification: account.requirements?.pending_verification ?? [],
        stripeCurrentDeadline: account.requirements?.current_deadline
          ? new Date(account.requirements.current_deadline * 1000)
          : null,
      },
    });

    // Compute identity status
    const identityRequired = (profile.completedSessionsCount ?? 0) >= 3;
    const identityStatus = profile.stripeIdentityVerified
      ? 'VERIFIED'
      : identityRequired
        ? (profile.stripeIdentityStatus ?? 'NOT_STARTED')
        : 'NOT_REQUIRED';

    const identityErrorMessages: Record<string, string> = {
      consent_declined: 'Vous avez refusé le consentement. Veuillez réessayer.',
      document_expired: 'Votre pièce d\'identité est expirée. Utilisez un document valide.',
      document_type_not_supported: 'Ce type de document n\'est pas accepté. Utilisez un passeport, une carte d\'identité ou un permis de conduire.',
      selfie_face_mismatch: 'Le selfie ne correspond pas à la photo du document. Réessayez avec un meilleur éclairage.',
      selfie_manipulated: 'La photo semble avoir été modifiée. Veuillez prendre une nouvelle photo.',
      selfie_document_missing_photo: 'La photo sur le document n\'est pas lisible. Réessayez avec un document en bon état.',
      under_supported_age: 'Vous devez avoir au moins 18 ans.',
    };

    const userMessages: Record<string, string> = {
      NOT_STARTED: 'Configurez votre compte pour recevoir vos paiements.',
      IN_PROGRESS: 'Votre inscription n\'est pas terminée. Reprenez là où vous en étiez.',
      PENDING_VERIFICATION: 'Vos informations sont en cours de vérification. Délai habituel : 1 à 2 jours.',
      COMPLETED: 'Votre compte est vérifié et prêt à recevoir des paiements.',
      ACTION_REQUIRED: 'Informations supplémentaires requises. Veuillez compléter votre profil.',
      PAST_DUE: 'Action urgente : des informations manquantes bloquent votre compte.',
      RESTRICTED: 'Votre compte est temporairement restreint. Contactez le support.',
      REJECTED: 'Votre vérification a été refusée. Contactez le support pour en savoir plus.',
    };

    const canApply = profile.stripeOnboardingCompleted
      && (!identityRequired || profile.stripeIdentityVerified);

    return {
      status,
      accountExists: true,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      disabledReason: account.requirements?.disabled_reason ?? null,
      requirements: {
        currentlyDue: account.requirements?.currently_due ?? [],
        pastDue: account.requirements?.past_due ?? [],
        pendingVerification: account.requirements?.pending_verification ?? [],
        eventuallyDue: account.requirements?.eventually_due ?? [],
        currentDeadline: account.requirements?.current_deadline
          ? new Date(account.requirements.current_deadline * 1000).toISOString()
          : null,
        errors: (account.requirements?.errors ?? []).map((e: any) => ({
          code: e.code,
          reason: e.reason,
          requirement: e.requirement,
        })),
      },
      identity: {
        status: identityStatus,
        required: identityRequired,
        verified: profile.stripeIdentityVerified,
        lastError: profile.stripeIdentityLastError,
        lastErrorMessage: profile.stripeIdentityLastError
          ? (identityErrorMessages[profile.stripeIdentityLastError] ?? 'La vérification a échoué. Veuillez réessayer avec des documents en bon état.')
          : null,
        sessionId: profile.stripeIdentitySessionId,
      },
      canApplyToCampaigns: canApply,
      canReceivePayments: account.charges_enabled && account.payouts_enabled,
      userMessage: userMessages[status] ?? userMessages.IN_PROGRESS,
    };
  }

  // ============================================================================
  // Payment Intents
  // ============================================================================

  async createPaymentIntent(
    amount: number,
    currency: string = 'eur',
    metadata: Record<string, any> = {},
    options: {
      description?: string;
      statementDescriptor?: string;
      transferGroup?: string;
      captureMethod?: 'automatic' | 'manual';
    } = {},
  ): Promise<Stripe.PaymentIntent> {
    try {
      const params: Stripe.PaymentIntentCreateParams = {
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        metadata,
        capture_method: options.captureMethod || 'automatic',
        automatic_payment_methods: {
          enabled: true,
        },
      };

      if (options.description) params.description = options.description;
      if (options.statementDescriptor) params.statement_descriptor = options.statementDescriptor;
      if (options.transferGroup) params.transfer_group = options.transferGroup;

      const paymentIntent = await this.stripe.paymentIntents.create(params);

      this.logger.log(`PaymentIntent created: ${paymentIntent.id} for ${amount}${currency.toUpperCase()}`);
      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to create PaymentIntent: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create payment intent');
    }
  }

  async createCheckoutSession(
    amount: number,
    currency: string = 'eur',
    metadata: Record<string, any> = {},
    successUrl: string,
    cancelUrl: string,
    options: {
      captureMethod?: 'automatic' | 'manual';
      productName?: string;
      productDescription?: string;
      statementDescriptor?: string;
      transferGroup?: string;
    } = {},
  ): Promise<Stripe.Checkout.Session> {
    const {
      captureMethod = 'automatic',
      productName = 'Campaign Payment',
      productDescription = `Payment for campaign ${metadata.campaignId}`,
      statementDescriptor,
      transferGroup,
    } = options;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: productName,
              description: productDescription,
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      payment_intent_data: {
        capture_method: captureMethod,
        metadata, // Metadata aussi sur le PaymentIntent pour le Dashboard Stripe
        ...(statementDescriptor && { statement_descriptor: statementDescriptor }),
        ...(transferGroup && { transfer_group: transferGroup }),
      },
    };

    // Separate Charges and Transfers: argent reste sur compte PLATEFORME
    // Les commissions et transfers seront gérés manuellement après

    try {
      const session = await this.stripe.checkout.sessions.create(sessionParams);

      this.logger.log(`Checkout Session created: ${session.id} for ${amount}${currency.toUpperCase()} (capture: ${captureMethod})`);
      return session;
    } catch (error) {
      this.logger.error(`Failed to create Checkout Session: ${error.message}`, error.stack);
      this.logger.error(`Stripe Error Details: ${JSON.stringify(error)}`);
      this.logger.error(`Session Params: ${JSON.stringify(sessionParams, null, 2)}`);
      throw new InternalServerErrorException(`Failed to create checkout session: ${error.message}`);
    }
  }

  async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      this.logger.error(`Failed to retrieve PaymentIntent ${paymentIntentId}: ${error.message}`);
      throw new NotFoundException('PaymentIntent not found');
    }
  }

  async confirmPaymentIntent(
    paymentIntentId: string,
    paymentMethodId: string,
  ): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      this.logger.log(`PaymentIntent confirmed: ${paymentIntentId}`);
      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to confirm PaymentIntent ${paymentIntentId}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to confirm payment');
    }
  }

  async capturePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.capture(paymentIntentId);
      this.logger.log(`PaymentIntent captured: ${paymentIntentId}`);
      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to capture PaymentIntent ${paymentIntentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to capture payment');
    }
  }

  async cancelPaymentIntent(
    paymentIntentId: string,
    reason?: string,
  ): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.cancel(paymentIntentId, {
        cancellation_reason: reason as Stripe.PaymentIntentCancelParams.CancellationReason,
      });

      this.logger.log(`PaymentIntent cancelled: ${paymentIntentId}`);
      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to cancel PaymentIntent ${paymentIntentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to cancel payment');
    }
  }

  // ============================================================================
  // Transfers
  // ============================================================================

  async getChargeIdFromPaymentIntent(paymentIntentId: string): Promise<string | null> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      const chargeId = paymentIntent.latest_charge;

      if (typeof chargeId === 'string') {
        this.logger.log(`Retrieved charge ${chargeId} from PaymentIntent ${paymentIntentId}`);
        return chargeId;
      }

      this.logger.warn(`No charge found for PaymentIntent ${paymentIntentId}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to retrieve charge from PaymentIntent: ${error.message}`);
      return null;
    }
  }

  async createTransfer(
    amount: number,
    destination: string,
    currency: string = 'eur',
    metadata: Record<string, any> = {},
    sourceTransaction?: string,
    transferGroup?: string,
    description?: string,
  ): Promise<Stripe.Transfer> {
    try {
      const transferParams: Stripe.TransferCreateParams = {
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        destination,
        metadata,
      };

      if (description) {
        transferParams.description = description;
      }

      // Add source_transaction if provided (links to specific charge)
      if (sourceTransaction) {
        transferParams.source_transaction = sourceTransaction;
      }

      // Add transfer_group if provided (groups related transfers)
      if (transferGroup) {
        transferParams.transfer_group = transferGroup;
      }

      const transfer = await this.stripe.transfers.create(transferParams);

      this.logger.log(`Transfer created: ${transfer.id} - ${amount}${currency.toUpperCase()} to ${destination}`);
      return transfer;
    } catch (error) {
      this.logger.error(`Failed to create transfer: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create transfer');
    }
  }

  /**
   * Create transfer from one Connect account to another (PRO → TESTEUR)
   * This is done ON BEHALF OF the source Connect account
   */
  async createConnectToConnectTransfer(
    amount: number,
    sourceAccount: string,
    destinationAccount: string,
    currency: string = 'eur',
    metadata: Record<string, any> = {},
  ): Promise<Stripe.Transfer> {
    try {
      // Transfer FROM the PRO's Connect account TO the TESTEUR's Connect account
      const transfer = await this.stripe.transfers.create(
        {
          amount: Math.round(amount * 100),
          currency,
          destination: destinationAccount,
          metadata,
        },
        {
          stripeAccount: sourceAccount, // Execute on behalf of PRO's Connect account
        },
      );

      this.logger.log(`Connect-to-Connect transfer: ${transfer.id} - ${amount}${currency.toUpperCase()} from ${sourceAccount} to ${destinationAccount}`);
      return transfer;
    } catch (error) {
      this.logger.error(`Failed to create Connect-to-Connect transfer: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create Connect-to-Connect transfer');
    }
  }

  // ============================================================================
  // Refunds
  // ============================================================================

  async createRefund(
    paymentIntentId: string,
    amount?: number,
    reason?: string,
    metadata?: Record<string, string>,
  ): Promise<Stripe.Refund> {
    try {
      const refundParams: Stripe.RefundCreateParams = {
        payment_intent: paymentIntentId,
      };

      if (amount) {
        refundParams.amount = Math.round(amount * 100); // Convert to cents
      }

      if (reason) {
        refundParams.reason = reason as Stripe.RefundCreateParams.Reason;
      }

      if (metadata) {
        refundParams.metadata = {
          platform: 'supertry',
          env: process.env.NODE_ENV || 'development',
          ...metadata,
        };
      }

      const refund = await this.stripe.refunds.create(refundParams);
      this.logger.log(`Refund created: ${refund.id} for PaymentIntent ${paymentIntentId}`);
      return refund;
    } catch (error) {
      this.logger.error(`Failed to create refund: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create refund');
    }
  }

  // ============================================================================
  // Stripe Identity (TESTEUR KYC)
  // ============================================================================

  /**
   * Créer une session de vérification d'identité Stripe Identity
   * Utilisé pour les TESTEURS (documents CNI/Passeport + selfie)
   */
  async createIdentityVerificationSession(
    profileId: string,
    returnUrl: string,
    metadata: Record<string, string> = {},
  ): Promise<{ clientSecret: string; url: string; sessionId: string }> {
    try {
      const session = await this.stripe.identity.verificationSessions.create({
        type: 'document',
        metadata: {
          platform: 'supertry',
          env: process.env.NODE_ENV || 'development',
          profileId,
          verificationType: 'tester_kyc',
          createdAt: new Date().toISOString(),
          ...metadata,
        },
        return_url: returnUrl,
        options: {
          document: {
            allowed_types: ['driving_license', 'passport', 'id_card'],
            require_live_capture: true,
            require_matching_selfie: true,
          },
        },
      });

      this.logger.log(`Identity Verification Session created: ${session.id} for profile ${profileId}`);
      return {
        clientSecret: session.client_secret!,
        url: session.url!,
        sessionId: session.id,
      };
    } catch (error) {
      this.logger.error(`Failed to create Identity Verification Session: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create identity verification session');
    }
  }

  /**
   * Récupérer le statut d'une vérification Identity
   */
  async getIdentityVerificationStatus(sessionId: string): Promise<{
    status: 'verified' | 'requires_input' | 'processing' | 'canceled';
    lastError: any;
  }> {
    try {
      const session = await this.stripe.identity.verificationSessions.retrieve(sessionId);

      return {
        status: session.status as any,
        lastError: session.last_error,
      };
    } catch (error) {
      this.logger.error(`Failed to retrieve Identity Verification Session ${sessionId}: ${error.message}`, error.stack);
      throw new NotFoundException('Identity verification session not found');
    }
  }

  // ============================================================================
  // Platform Transfers (PLATEFORME → Connect Accounts)
  // ============================================================================

  /**
   * Créer un transfer depuis le compte PLATEFORME vers un Connect account
   * Remplace createConnectToConnectTransfer() dans le nouveau modèle "Separate Charges and Transfers"
   */
  async createPlatformToConnectTransfer(
    amount: number,
    destinationAccount: string,
    currency: string = 'eur',
    metadata: Record<string, any> = {},
    description?: string,
    transferGroup?: string,
  ): Promise<Stripe.Transfer> {
    try {
      // 1. Vérifier compte destination AVANT transfer
      const account = await this.stripe.accounts.retrieve(destinationAccount);
      if (!account.charges_enabled) {
        throw new BadRequestException(
          `Destination account ${destinationAccount} cannot receive transfers (charges_enabled=false)`,
        );
      }
      if (
        account.requirements?.currently_due &&
        account.requirements.currently_due.length > 0
      ) {
        throw new BadRequestException(
          `Destination account has pending requirements: ${account.requirements.currently_due.join(', ')}`,
        );
      }

      // 2. Récupérer le Charge de la campagne pour transfer immédiat
      // En utilisant source_transaction (Charge ID), on peut transférer directement
      // sans attendre que les fonds deviennent disponibles dans le balance (2-7 jours)
      let sourceTransaction: string | undefined;
      if (metadata.campaignId) {
        try {
          const campaign = await this.prisma.campaign.findUnique({
            where: { id: metadata.campaignId },
            select: { stripePaymentIntentId: true },
          });

          if (campaign?.stripePaymentIntentId) {
            // Récupérer le PaymentIntent pour obtenir le Charge ID
            const paymentIntent = await this.stripe.paymentIntents.retrieve(
              campaign.stripePaymentIntentId,
            );

            // Le Charge est dans paymentIntent.latest_charge
            const chargeId = typeof paymentIntent.latest_charge === 'string'
              ? paymentIntent.latest_charge
              : paymentIntent.latest_charge?.id;

            if (chargeId) {
              sourceTransaction = chargeId;
              this.logger.log(`💡 Using source_transaction (Charge): ${sourceTransaction} (instant transfer)`);
            } else {
              this.logger.warn(`No charge found for PaymentIntent ${campaign.stripePaymentIntentId}`);
            }
          }
        } catch (err) {
          this.logger.warn(`Could not retrieve campaign Charge: ${err.message}`);
        }
      }

      // 3. Créer transfer depuis compte PLATEFORME
      const transferParams: any = {
        amount: Math.round(amount * 100),
        currency,
        destination: destinationAccount,
        metadata,
      };

      // Utiliser source_transaction si disponible pour transfer immédiat
      // Sinon, le transfer se fera depuis le balance disponible
      if (sourceTransaction) {
        transferParams.source_transaction = sourceTransaction;
      }
      if (description) {
        transferParams.description = description;
      }
      if (transferGroup) {
        transferParams.transfer_group = transferGroup;
      }

      const transfer = await this.stripe.transfers.create(
        transferParams,
        {
          idempotencyKey: `platform-transfer-${metadata.sessionId || metadata.campaignId}-${Date.now()}`,
        },
      );

      this.logger.log(`Platform Transfer created: ${transfer.id} - ${amount}€ → ${destinationAccount}${sourceTransaction ? ' (using source_transaction)' : ''}`);
      return transfer;
    } catch (error) {
      this.logger.error(`Failed to create Platform Transfer: ${error.message}`);
      throw new InternalServerErrorException(`Transfer failed: ${error.message}`);
    }
  }

  // ============================================================================
  // Payouts (Retraits vers IBAN)
  // ============================================================================

  /**
   * Créer un payout depuis un Connect account vers son IBAN
   * Pour permettre aux PRO et TESTEURS de retirer leur argent
   */
  async createPayout(
    amount: number,
    stripeConnectAccountId: string,
    currency: string = 'eur',
    metadata: Record<string, any> = {},
  ): Promise<Stripe.Payout> {
    try {
      // Vérifier que le compte a un external_account (IBAN)
      const account = await this.stripe.accounts.retrieve(stripeConnectAccountId);
      if (!account.external_accounts?.data?.length) {
        throw new BadRequestException('No bank account linked. Please add an IBAN first.');
      }
      if (!account.payouts_enabled) {
        throw new BadRequestException('Payouts not enabled for this account');
      }

      // Vérifier le solde disponible sur le Connect account
      const balance = await this.stripe.balance.retrieve({
        stripeAccount: stripeConnectAccountId,
      });
      const availableBalance = balance.available
        .filter((b) => b.currency === currency)
        .reduce((sum, b) => sum + b.amount, 0);
      const availableInEuros = availableBalance / 100;
      const pendingBalance = balance.pending
        .filter((b) => b.currency === currency)
        .reduce((sum, b) => sum + b.amount, 0);
      const pendingInEuros = pendingBalance / 100;

      if (amount > availableInEuros) {
        // Récupérer la date de disponibilité des fonds pending
        let nextAvailableDate: string | null = null;
        if (pendingBalance > 0) {
          try {
            const pendingTxns = await this.stripe.balanceTransactions.list(
              { limit: 10 },
              { stripeAccount: stripeConnectAccountId },
            );
            const pendingTxn = pendingTxns.data.find((t) => t.status === 'pending');
            if (pendingTxn?.available_on) {
              nextAvailableDate = new Date(pendingTxn.available_on * 1000).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              });
            }
          } catch {
            // Silencieux si la récupération échoue
          }
        }

        const dateInfo = nextAvailableDate
          ? `Prochaine disponibilité : ${nextAvailableDate}.`
          : `Les fonds deviennent disponibles sous quelques jours.`;

        throw new BadRequestException(
          `Solde disponible insuffisant pour ce retrait. Disponible maintenant : ${availableInEuros.toFixed(2)}€. ` +
          `En cours de traitement : ${pendingInEuros.toFixed(2)}€. ${dateInfo}`,
        );
      }

      // Créer payout depuis Connect account vers IBAN
      const payout = await this.stripe.payouts.create(
        {
          amount: Math.round(amount * 100),
          currency,
          metadata,
        },
        {
          stripeAccount: stripeConnectAccountId, // Execute on behalf of Connect account
          idempotencyKey: `payout-${metadata.withdrawalId}-${Date.now()}`,
        },
      );

      this.logger.log(`Payout created: ${payout.id} - ${amount}€ from ${stripeConnectAccountId}`);
      return payout;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to create Payout: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Payout failed: ${error.message}`);
    }
  }

  // ============================================================================
  // Balance & Reporting
  // ============================================================================

  async listBalanceTransactions(params: {
    limit?: number;
    startingAfter?: string;
    endingBefore?: string;
    created?: { gte?: number; lte?: number };
    type?: string;
  } = {}): Promise<Stripe.ApiList<Stripe.BalanceTransaction>> {
    try {
      const listParams: Stripe.BalanceTransactionListParams = {
        limit: params.limit || 25,
        expand: ['data.source'],
      };

      if (params.startingAfter) listParams.starting_after = params.startingAfter;
      if (params.endingBefore) listParams.ending_before = params.endingBefore;
      if (params.created) listParams.created = params.created;
      if (params.type) listParams.type = params.type;

      return await this.stripe.balanceTransactions.list(listParams);
    } catch (error) {
      this.logger.error(`Failed to list balance transactions: ${error.message}`);
      throw new InternalServerErrorException('Failed to list balance transactions');
    }
  }

  async getPlatformBalance(): Promise<Stripe.Balance> {
    try {
      return await this.stripe.balance.retrieve();
    } catch (error) {
      this.logger.error(`Failed to retrieve platform balance: ${error.message}`);
      throw new InternalServerErrorException('Failed to retrieve platform balance');
    }
  }

  // ============================================================================
  // Test Helpers (Development Only)
  // ============================================================================

  /**
   * Crée un TopUp en mode test pour rendre les fonds immédiatement disponibles
   * En production, les fonds deviennent disponibles automatiquement après 2-7 jours
   */
  async createTestTopUp(amount: number): Promise<Stripe.Topup> {
    try {
      const topup = await this.stripe.topups.create({
        amount: Math.round(amount * 100),
        currency: 'eur',
        description: `Test TopUp - Simulating available balance for transfers`,
        statement_descriptor: 'TEST TOPUP',
      });

      this.logger.log(`✅ Test TopUp created: ${topup.id} - ${amount}€ added to available balance`);
      return topup;
    } catch (error) {
      this.logger.error(`Failed to create test TopUp: ${error.message}`);
      throw new InternalServerErrorException(`Test TopUp failed: ${error.message}`);
    }
  }

  // ============================================================================
  // Customers & Invoicing (Facturation PRO)
  // ============================================================================

  /**
   * Récupère ou crée un Stripe Customer pour un PRO (pour la facturation)
   */
  async getOrCreateCustomer(profile: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    stripeCustomerId?: string | null;
  }): Promise<string> {
    // Si le profil a déjà un customerId, vérifier qu'il existe encore
    if (profile.stripeCustomerId) {
      try {
        await this.stripe.customers.retrieve(profile.stripeCustomerId);
        return profile.stripeCustomerId;
      } catch {
        this.logger.warn(`Stripe Customer ${profile.stripeCustomerId} not found, creating new one`);
      }
    }

    // Créer un nouveau customer
    const name = profile.companyName
      || [profile.firstName, profile.lastName].filter(Boolean).join(' ')
      || profile.email;

    const customer = await this.stripe.customers.create({
      email: profile.email,
      name,
      metadata: {
        profileId: profile.id,
        platform: 'supertry',
        env: process.env.NODE_ENV || 'development',
      },
    });

    // Sauvegarder le customerId sur le profil
    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { stripeCustomerId: customer.id },
    });

    this.logger.log(`Stripe Customer created: ${customer.id} for profile ${profile.id}`);
    return customer.id;
  }

  /**
   * Crée une facture Stripe avec line items pour une campagne payée
   * La facture est finalisée et marquée comme payée (out-of-band)
   */
  async createInvoiceForCampaign(
    customerId: string,
    escrow: {
      breakdown: {
        productCost: number;
        shippingCost: number;
        testerBonus: number;
        supertryCommission: number;
        proBonus: number;
        stripeFees: number;
      };
      totalSlots: number;
      campaignTitle: string;
    },
    campaignId: string,
  ): Promise<{ invoiceId: string; invoiceUrl: string; invoicePdf: string }> {
    const { breakdown, totalSlots } = escrow;

    // Créer les Invoice Items (en centimes)
    const lineItems: { description: string; amount: number }[] = [
      { description: `Remboursement produit (x${totalSlots})`, amount: breakdown.productCost * totalSlots },
      { description: `Frais de port (x${totalSlots})`, amount: breakdown.shippingCost * totalSlots },
      { description: `Bonus testeur (x${totalSlots})`, amount: breakdown.testerBonus * totalSlots },
      { description: `Bonus PRO (x${totalSlots})`, amount: breakdown.proBonus * totalSlots },
      { description: `Commission SuperTry (x${totalSlots})`, amount: breakdown.supertryCommission * totalSlots },
      { description: `Couverture frais Stripe (x${totalSlots})`, amount: breakdown.stripeFees * totalSlots },
    ];

    // Filtrer les lignes à 0
    const nonZeroItems = lineItems.filter(item => item.amount > 0);

    for (const item of nonZeroItems) {
      await this.stripe.invoiceItems.create({
        customer: customerId,
        amount: Math.round(item.amount * 100),
        currency: 'eur',
        description: item.description,
      });
    }

    // Créer l'invoice
    const invoice = await this.stripe.invoices.create({
      customer: customerId,
      auto_advance: false,
      collection_method: 'send_invoice',
      days_until_due: 0,
      metadata: {
        campaignId,
        platform: 'supertry',
      },
      description: `Campagne SuperTry : ${escrow.campaignTitle}`,
    });

    // Finaliser l'invoice
    const finalizedInvoice = await this.stripe.invoices.finalizeInvoice(invoice.id);

    // Marquer comme payée (le paiement a déjà été effectué via PaymentIntent)
    const paidInvoice = await this.stripe.invoices.pay(invoice.id, {
      paid_out_of_band: true,
    });

    this.logger.log(`Invoice created and paid: ${paidInvoice.id} for campaign ${campaignId}`);

    return {
      invoiceId: paidInvoice.id,
      invoiceUrl: paidInvoice.hosted_invoice_url || finalizedInvoice.hosted_invoice_url || '',
      invoicePdf: paidInvoice.invoice_pdf || finalizedInvoice.invoice_pdf || '',
    };
  }

  // ============================================================================
  // Webhooks
  // ============================================================================

  constructEvent(
    payload: string | Buffer | any,
    signature: string,
  ): Stripe.Event {
    const skipVerification = this.configService.get<string>('STRIPE_SKIP_SIGNATURE_VERIFICATION') === 'true';

    // Skip verification for local testing with Stripe CLI
    if (skipVerification) {
      this.logger.warn('⚠️  Webhook signature verification SKIPPED (dev mode only!)');
      // If payload is already a parsed object (happens with NestJS body parsing)
      if (typeof payload === 'object' && !(payload instanceof Buffer)) {
        return payload as Stripe.Event;
      }
      // Otherwise parse the string/buffer
      const payloadStr = payload instanceof Buffer ? payload.toString() : payload;
      return JSON.parse(payloadStr);
    }

    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }
}
