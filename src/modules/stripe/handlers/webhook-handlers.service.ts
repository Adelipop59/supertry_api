import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { StripeService } from '../stripe.service';
import {
  AuditCategory,
  NotificationType,
  CampaignStatus,
  WithdrawalStatus,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { NotificationTemplate } from '../../notifications/enums/notification-template.enum';
import { Decimal } from '@prisma/client/runtime/library';
import Stripe from 'stripe';

/**
 * Service dédié à la gestion des webhooks Stripe
 * Factorisation pour éviter un controller géant
 */
@Injectable()
export class WebhookHandlersService {
  private readonly logger = new Logger(WebhookHandlersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => StripeService))
    private readonly stripeService: StripeService,
  ) {}

  // ==========================================================================
  // Account Webhooks (Onboarding PRO + TESTEUR)
  // ==========================================================================

  async handleAccountUpdated(account: Stripe.Account) {
    const profile = await this.prisma.profile.findUnique({
      where: { stripeConnectAccountId: account.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        stripeOnboardingCompleted: true,
        stripeOnboardingStatus: true,
        role: true,
      },
    });

    if (!profile) {
      this.logger.warn(`Profile not found for Stripe account ${account.id}`);
      return;
    }

    // 1. Compute new status
    const newStatus = this.computeOnboardingStatus(account);
    const previousStatus = profile.stripeOnboardingStatus;
    const isNowCompleted = account.charges_enabled && account.details_submitted;

    // 2. Update detailed status fields in DB
    await this.prisma.profile.update({
      where: { stripeConnectAccountId: account.id },
      data: {
        stripeOnboardingCompleted: isNowCompleted,
        stripeOnboardingStatus: newStatus,
        stripeDisabledReason: account.requirements?.disabled_reason ?? null,
        stripeRequirementsCurrentlyDue: account.requirements?.currently_due ?? [],
        stripeRequirementsPastDue: account.requirements?.past_due ?? [],
        stripeRequirementsPendingVerification: account.requirements?.pending_verification ?? [],
        stripeCurrentDeadline: account.requirements?.current_deadline
          ? new Date(account.requirements.current_deadline * 1000)
          : null,
      },
    });

    // 2b. Enrich profile with verified data from Stripe Connect (first time COMPLETED)
    if (newStatus === 'COMPLETED' && previousStatus !== 'COMPLETED') {
      try {
        await this.enrichProfileFromConnect(account, profile.id);
      } catch (error) {
        this.logger.error(`Failed to enrich profile ${profile.id} from Connect: ${error.message}`);
      }
    }

    // 3. Audit log
    await this.auditService.log(profile.id, AuditCategory.USER, 'STRIPE_ACCOUNT_UPDATED', {
      stripeAccountId: account.id,
      previousStatus,
      newStatus,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      disabledReason: account.requirements?.disabled_reason ?? null,
      role: profile.role,
    });

    // 4. Send differentiated notifications based on status transitions
    // Onboarding completed
    if (newStatus === 'COMPLETED' && previousStatus !== 'COMPLETED') {
      const message = profile.role === 'PRO'
        ? 'Your Stripe onboarding is complete. You can now activate campaigns.'
        : 'Your Stripe onboarding is complete. You can now apply to campaigns.';

      await this.notificationsService.queueEmail({
        to: profile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Stripe Onboarding Completed',
        variables: {
          firstName: profile.firstName,
          message,
        },
        metadata: {
          userId: profile.id,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }

    // Action required (documents rejected, additional info needed)
    if (newStatus === 'ACTION_REQUIRED' && previousStatus !== 'ACTION_REQUIRED') {
      const errors = account.requirements?.errors ?? [];
      const errorDetails = errors.map((e: any) => e.reason).filter(Boolean).join(', ');

      await this.notificationsService.queueEmail({
        to: profile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Action requise sur votre compte Stripe',
        variables: {
          firstName: profile.firstName,
          message: `Des informations supplémentaires sont nécessaires pour votre compte Stripe.${errorDetails ? ` Détails : ${errorDetails}.` : ''} Ouvrez l'app pour compléter votre vérification.`,
        },
        metadata: {
          userId: profile.id,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }

    // Past due (urgent)
    if (newStatus === 'PAST_DUE' && previousStatus !== 'PAST_DUE') {
      await this.notificationsService.queueEmail({
        to: profile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Action urgente requise sur votre compte Stripe',
        variables: {
          firstName: profile.firstName,
          message: 'Des informations manquantes bloquent votre compte. Connectez-vous immédiatement pour résoudre le problème.',
        },
        metadata: {
          userId: profile.id,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }

    // Restricted or rejected
    if (['RESTRICTED', 'REJECTED'].includes(newStatus) && ![previousStatus].some(s => ['RESTRICTED', 'REJECTED'].includes(s ?? ''))) {
      await this.notificationsService.queueEmail({
        to: profile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Compte Stripe restreint',
        variables: {
          firstName: profile.firstName,
          message: 'Votre compte a été restreint. Veuillez contacter le support.',
        },
        metadata: {
          userId: profile.id,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }

    // Pending verification (submitted, waiting for Stripe)
    if (newStatus === 'PENDING_VERIFICATION' && previousStatus === 'IN_PROGRESS') {
      await this.notificationsService.queueEmail({
        to: profile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Vérification en cours',
        variables: {
          firstName: profile.firstName,
          message: 'Vos informations ont été soumises et sont en cours de vérification. Vous serez notifié dès que le processus sera terminé.',
        },
        metadata: {
          userId: profile.id,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }
  }

  private computeOnboardingStatus(account: Stripe.Account): string {
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

  /**
   * Enrichir le profil SuperTry avec les données vérifiées du compte Stripe Connect.
   * Appelé une fois quand l'onboarding passe à COMPLETED.
   * Ne remplit que les champs vides (ne surcharge pas les données existantes).
   */
  private async enrichProfileFromConnect(account: Stripe.Account, profileId: string) {
    const individual = account.individual;
    if (!individual) {
      this.logger.warn(`No individual data on Stripe account ${account.id}`);
      return;
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        firstName: true, lastName: true, phone: true, birthDate: true,
        addressLine1: true, addressCity: true, addressPostalCode: true,
        addressState: true, country: true,
      },
    });

    if (!profile) return;

    const updateData: Record<string, any> = {
      stripeConnectDataSyncedAt: new Date(),
    };

    if (!profile.firstName && individual.first_name) {
      updateData.firstName = individual.first_name;
    }
    if (!profile.lastName && individual.last_name) {
      updateData.lastName = individual.last_name;
    }
    if (!profile.phone && individual.phone) {
      updateData.phone = individual.phone;
    }
    if (!profile.birthDate && individual.dob) {
      const { day, month, year } = individual.dob;
      if (day && month && year) {
        updateData.birthDate = new Date(Date.UTC(year, month - 1, day));
      }
    }
    if (individual.address) {
      if (!profile.addressLine1 && individual.address.line1) {
        updateData.addressLine1 = individual.address.line1;
      }
      if (individual.address.line2) {
        updateData.addressLine2 = individual.address.line2;
      }
      if (!profile.addressCity && individual.address.city) {
        updateData.addressCity = individual.address.city;
      }
      if (!profile.addressPostalCode && individual.address.postal_code) {
        updateData.addressPostalCode = individual.address.postal_code;
      }
      if (!profile.addressState && individual.address.state) {
        updateData.addressState = individual.address.state;
      }
      if (!profile.country && individual.address.country) {
        updateData.country = individual.address.country;
      }
    }

    await this.prisma.profile.update({
      where: { id: profileId },
      data: updateData,
    });

    const fieldsUpdated = Object.keys(updateData).filter(k => k !== 'stripeConnectDataSyncedAt');
    this.logger.log(`Profile ${profileId} enriched from Stripe Connect ${account.id}: ${fieldsUpdated.join(', ')}`);

    await this.auditService.log(profileId, AuditCategory.USER, 'PROFILE_ENRICHED_FROM_CONNECT', {
      stripeAccountId: account.id,
      fieldsUpdated,
    });
  }

  async handleAccountExternalAccountCreated(event: Stripe.Event) {
    await this.auditService.log(null, AuditCategory.SYSTEM, 'STRIPE_EXTERNAL_ACCOUNT_CREATED', {
      accountId: event.account,
      externalAccountId: (event.data.object as any).id,
      type: (event.data.object as any).object,
    });
  }

  async handleAccountExternalAccountDeleted(event: Stripe.Event) {
    await this.auditService.log(null, AuditCategory.SYSTEM, 'STRIPE_EXTERNAL_ACCOUNT_DELETED', {
      accountId: event.account,
      externalAccountId: (event.data.object as any).id,
    });
  }

  async handleCapabilityUpdated(event: Stripe.Event, capability: Stripe.Capability) {
    await this.auditService.log(null, AuditCategory.SYSTEM, 'STRIPE_CAPABILITY_UPDATED', {
      accountId: event.account,
      capability: capability.id,
      status: capability.status,
    });

    // Si capability devient inactive → notifier user
    if (capability.status === 'inactive') {
      const profile = await this.prisma.profile.findUnique({
        where: { stripeConnectAccountId: event.account as string },
        select: { email: true, firstName: true },
      });

      if (profile) {
        await this.notificationsService.queueEmail({
          to: profile.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Stripe Capability Issue',
          variables: {
            firstName: profile.firstName,
            message: `Capability ${capability.id} is now inactive. Please update your Stripe account.`,
          },
          metadata: { type: NotificationType.SYSTEM_ALERT },
        });
      }
    }
  }

  // ==========================================================================
  // Identity Webhooks (TESTEUR KYC)
  // ==========================================================================

  async handleIdentitySessionCreated(session: Stripe.Identity.VerificationSession) {
    await this.auditService.log(
      session.metadata?.profileId || null,
      AuditCategory.USER,
      'STRIPE_IDENTITY_SESSION_CREATED',
      {
        verificationSessionId: session.id,
        status: session.status,
      },
    );
  }

  async handleIdentitySessionProcessing(session: Stripe.Identity.VerificationSession) {
    const profileId = session.metadata?.profileId;

    if (profileId) {
      // Save detailed Identity status
      await this.prisma.profile.update({
        where: { id: profileId },
        data: {
          stripeIdentityStatus: 'PROCESSING',
          stripeIdentityLastError: null,
          stripeIdentitySessionId: session.id,
        },
      });

      await this.auditService.log(profileId, AuditCategory.USER, 'STRIPE_IDENTITY_PROCESSING', {
        verificationSessionId: session.id,
      });

      const user = await this.prisma.profile.findUnique({
        where: { id: profileId },
        select: { email: true, firstName: true },
      });

      if (user) {
        await this.notificationsService.queueEmail({
          to: user.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Identity Verification - In Progress',
          variables: {
            firstName: user.firstName,
            message: 'Your identity verification is being processed. You will be notified once completed.',
          },
          metadata: {
            userId: profileId,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }
    }
  }

  async handleIdentitySessionVerified(session: Stripe.Identity.VerificationSession) {
    this.logger.log(`WEBHOOK: identity.verification_session.verified - Session ID: ${session.id}`);

    const profileId = session.metadata?.profileId;

    if (!profileId) {
      this.logger.error(`No profileId in verification session ${session.id} - Metadata: ${JSON.stringify(session.metadata)}`);
      return;
    }

    const testerProfile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, birthDate: true,
        stripeIdentityVerified: true,
      },
    });

    if (!testerProfile) {
      this.logger.warn(`Profile not found for ID ${profileId}`);
      return;
    }

    if (testerProfile.stripeIdentityVerified) {
      this.logger.log(`Profile ${profileId} already verified, skipping`);
      return;
    }

    // Récupérer les verified_outputs depuis Stripe Identity
    let verifiedOutputs: any = null;
    try {
      const fullSession = await this.stripeService.retrieveIdentitySessionWithOutputs(session.id);
      verifiedOutputs = (fullSession as any).verified_outputs;
    } catch (error) {
      this.logger.error(`Failed to retrieve verified_outputs for session ${session.id}: ${error.message}`);
    }

    // Vérification de cohérence : comparer données profil (venant de Connect) vs Identity KYC
    let verificationStatus: string | null = null;
    let mismatchDetails: Record<string, any> | null = null;

    if (verifiedOutputs && testerProfile.firstName && testerProfile.lastName) {
      const mismatches: Record<string, { profile: string; identity: string }> = {};

      // Comparer prénom (case-insensitive, trimmed)
      const profileFirstName = (testerProfile.firstName || '').trim().toLowerCase();
      const identityFirstName = (verifiedOutputs.first_name || '').trim().toLowerCase();
      if (profileFirstName && identityFirstName && profileFirstName !== identityFirstName) {
        mismatches.firstName = {
          profile: testerProfile.firstName!,
          identity: verifiedOutputs.first_name,
        };
      }

      // Comparer nom
      const profileLastName = (testerProfile.lastName || '').trim().toLowerCase();
      const identityLastName = (verifiedOutputs.last_name || '').trim().toLowerCase();
      if (profileLastName && identityLastName && profileLastName !== identityLastName) {
        mismatches.lastName = {
          profile: testerProfile.lastName!,
          identity: verifiedOutputs.last_name,
        };
      }

      // Comparer date de naissance
      if (testerProfile.birthDate && verifiedOutputs.dob) {
        const profileDob = testerProfile.birthDate;
        const identityDob = verifiedOutputs.dob;
        if (identityDob.day && identityDob.month && identityDob.year) {
          const identityDate = new Date(Date.UTC(identityDob.year, identityDob.month - 1, identityDob.day));
          if (profileDob.getTime() !== identityDate.getTime()) {
            mismatches.dateOfBirth = {
              profile: profileDob.toISOString().split('T')[0],
              identity: `${identityDob.year}-${String(identityDob.month).padStart(2, '0')}-${String(identityDob.day).padStart(2, '0')}`,
            };
          }
        }
      }

      if (Object.keys(mismatches).length > 0) {
        verificationStatus = 'INCOHERENT';
        mismatchDetails = {
          mismatches,
          verificationSessionId: session.id,
          detectedAt: new Date().toISOString(),
        };
        this.logger.warn(`IDENTITY MISMATCH for profile ${profileId}: ${JSON.stringify(mismatches)}`);
      } else {
        verificationStatus = 'COHERENT';
      }
    }

    // Mettre à jour le profil
    await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        stripeIdentityVerified: true,
        stripeOnboardingCompleted: true,
        stripeIdentityStatus: 'VERIFIED',
        stripeIdentityLastError: null,
        ...(verificationStatus && { verificationStatus }),
        ...(mismatchDetails && { verificationMismatchDetails: mismatchDetails }),
      },
    });

    // Audit
    await this.auditService.log(profileId, AuditCategory.USER, 'STRIPE_IDENTITY_VERIFIED', {
      verificationSessionId: session.id,
      verificationStatus: verificationStatus || 'NO_CHECK',
      ...(mismatchDetails && { mismatchDetails }),
    });

    // Notification différenciée
    if (verificationStatus === 'INCOHERENT') {
      await this.notificationsService.queueEmail({
        to: testerProfile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Vérification d\'identité - Incohérence détectée',
        variables: {
          firstName: testerProfile.firstName || 'Utilisateur',
          message: 'Une incohérence a été détectée entre vos informations d\'inscription et votre pièce d\'identité. Votre compte est temporairement bloqué. Veuillez contacter le support pour résoudre ce problème.',
        },
        metadata: {
          userId: profileId,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
      this.logger.warn(`ACCOUNT FLAGGED INCOHERENT: ${profileId} (${testerProfile.email})`);
    } else {
      await this.notificationsService.queueEmail({
        to: testerProfile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Vérification d\'identité terminée',
        variables: {
          firstName: testerProfile.firstName || 'Utilisateur',
          message: 'Votre identité a été vérifiée avec succès. Vous pouvez maintenant postuler à des campagnes et recevoir des paiements.',
        },
        metadata: {
          userId: profileId,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }
  }

  async handleIdentitySessionRequiresInput(session: Stripe.Identity.VerificationSession) {
    const profileId = session.metadata?.profileId;

    if (profileId) {
      // Extract the error code from the session
      const lastErrorCode = (session.last_error as any)?.code ?? 'unknown';

      // Block user + save detailed Identity status
      await this.prisma.profile.update({
        where: { id: profileId },
        data: {
          stripeIdentityVerified: false,
          stripeIdentityStatus: 'REQUIRES_INPUT',
          stripeIdentityLastError: lastErrorCode,
          stripeIdentitySessionId: session.id,
        },
      });

      // Audit
      await this.auditService.log(profileId, AuditCategory.USER, 'STRIPE_IDENTITY_REQUIRES_INPUT', {
        verificationSessionId: session.id,
        lastError: session.last_error,
        lastErrorCode,
      });

      // Notification critique
      const user = await this.prisma.profile.findUnique({
        where: { id: profileId },
        select: { email: true, firstName: true },
      });

      if (user) {
        await this.notificationsService.queueEmail({
          to: user.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Identity Verification - Additional Information Required',
          variables: {
            firstName: user.firstName,
            message: 'We need additional information to verify your identity. Please complete the verification process.',
          },
          metadata: {
            userId: profileId,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }
    }
  }

  async handleIdentitySessionCanceled(session: Stripe.Identity.VerificationSession) {
    const profileId = session.metadata?.profileId;

    if (profileId) {
      await this.prisma.profile.update({
        where: { id: profileId },
        data: {
          stripeIdentityStatus: 'CANCELED',
        },
      });

      await this.auditService.log(profileId, AuditCategory.USER, 'STRIPE_IDENTITY_CANCELED', {
        verificationSessionId: session.id,
      });
    }
  }

  async handleIdentitySessionRedacted(session: Stripe.Identity.VerificationSession) {
    const profileId = session.metadata?.profileId;

    if (profileId) {
      await this.auditService.log(profileId, AuditCategory.USER, 'STRIPE_IDENTITY_REDACTED', {
        verificationSessionId: session.id,
      });
    }
  }

  // ==========================================================================
  // Payment Intent Webhooks
  // ==========================================================================

  async handlePaymentIntentCreated(paymentIntent: Stripe.PaymentIntent) {
    await this.auditService.log(null, AuditCategory.WALLET, 'PAYMENT_INTENT_CREATED', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      status: paymentIntent.status,
    });
  }

  async handlePaymentIntentProcessing(paymentIntent: Stripe.PaymentIntent) {
    await this.auditService.log(null, AuditCategory.WALLET, 'PAYMENT_INTENT_PROCESSING', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
    });
  }

  async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    await this.auditService.log(null, AuditCategory.WALLET, 'PAYMENT_INTENT_SUCCEEDED', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
    });
  }

  async handlePaymentIntentPaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    // Trouver campagne associée
    const campaignId = paymentIntent.metadata?.campaignId;
    if (campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { seller: true },
      });

      if (campaign) {
        // Revenir en DRAFT
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { status: CampaignStatus.DRAFT },
        });

        // Audit
        await this.auditService.log(campaign.sellerId, AuditCategory.WALLET, 'PAYMENT_INTENT_FAILED', {
          paymentIntentId: paymentIntent.id,
          campaignId,
          amount: paymentIntent.amount / 100,
          failureCode: paymentIntent.last_payment_error?.code,
          failureMessage: paymentIntent.last_payment_error?.message,
        });

        // Notification PRO
        await this.notificationsService.queueEmail({
          to: campaign.seller.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Campaign Payment Failed',
          variables: {
            firstName: campaign.seller.firstName,
            campaignTitle: campaign.title,
            message: `Payment failed for campaign "${campaign.title}". Please try again.`,
          },
          metadata: {
            campaignId,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }
    }
  }

  async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent) {
    const campaignId = paymentIntent.metadata?.campaignId;

    if (campaignId) {
      // Annulation du PI = annulation campagne (manual capture: 0 frais)
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, title: true, sellerId: true, status: true, stripePaymentIntentId: true },
      });

      // Ignorer si le PI annulé n'est plus le PI actif de la campagne
      // (cas: le PRO relance un paiement → ancien PI annulé, nouveau PI créé)
      if (campaign && campaign.stripePaymentIntentId && campaign.stripePaymentIntentId !== paymentIntent.id) {
        this.logger.log(
          `Ignoring cancelled PI ${paymentIntent.id} for campaign ${campaignId} - active PI is ${campaign.stripePaymentIntentId}`,
        );
      } else if (campaign && (campaign.status === CampaignStatus.PENDING_PAYMENT || campaign.status === CampaignStatus.PENDING_ACTIVATION)) {
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { status: CampaignStatus.CANCELLED },
        });

        // Mettre à jour la transaction associée
        const transaction = await this.prisma.transaction.findFirst({
          where: { campaignId, stripePaymentIntentId: paymentIntent.id },
        });
        if (transaction) {
          await this.prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'CANCELLED' as any },
          });
        }

        // Notification PRO
        const sellerProfile = await this.prisma.profile.findUnique({
          where: { id: campaign.sellerId },
          select: { email: true, firstName: true },
        });

        if (sellerProfile) {
          await this.notificationsService.queueEmail({
            to: sellerProfile.email,
            template: NotificationTemplate.GENERIC_NOTIFICATION,
            subject: 'Campaign Cancelled - No Charges',
            variables: {
              firstName: sellerProfile.firstName,
              campaignTitle: campaign.title,
              message: `Your campaign "${campaign.title}" has been cancelled. No charges were applied.`,
            },
            metadata: {
              campaignId,
              type: NotificationType.SYSTEM_ALERT,
            },
          });
        }

        this.logger.log(`Campaign ${campaignId} cancelled via PI cancellation (0 fees)`);
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'PAYMENT_INTENT_CANCELED', {
      paymentIntentId: paymentIntent.id,
      campaignId: campaignId || null,
      amount: paymentIntent.amount / 100,
      captureMethod: paymentIntent.capture_method,
    });
  }

  /**
   * Quand le PI passe en requires_capture (manual capture autorisé)
   * Sert de confirmation que l'autorisation est réussie
   */
  async handlePaymentIntentAmountCapturableUpdated(paymentIntent: Stripe.PaymentIntent) {
    const campaignId = paymentIntent.metadata?.campaignId;

    this.logger.log(`PI ${paymentIntent.id} amount_capturable_updated: ${paymentIntent.amount_capturable / 100}€`);

    // Mettre à jour la campagne : enregistrer paymentAuthorizedAt pour que le scheduler puisse capturer
    if (campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, status: true, paymentAuthorizedAt: true, stripePaymentIntentId: true },
      });

      if (campaign && (campaign.status === CampaignStatus.PENDING_PAYMENT || campaign.status === CampaignStatus.PENDING_ACTIVATION)) {
        // Idempotence: si paymentAuthorizedAt est déjà set pour CE PI, ne pas re-update (double delivery)
        if (campaign.stripePaymentIntentId === paymentIntent.id && campaign.paymentAuthorizedAt) {
          this.logger.log(`Campaign ${campaignId} already authorized for PI ${paymentIntent.id}, skipping (idempotent)`);
        } else if (campaign.stripePaymentIntentId === paymentIntent.id || !campaign.paymentAuthorizedAt) {
          // PI correspond au dernier stocké, ou aucun paymentAuthorizedAt n'est encore set
          // Calculer la fin de la grace period
          const rules = await this.prisma.businessRules.findFirst({ orderBy: { createdAt: 'desc' } });
          const captureDelayMinutes = rules?.captureDelayMinutes ?? 60;
          const now = new Date();
          const gracePeriodEnd = new Date(now.getTime() + captureDelayMinutes * 60 * 1000);

          await this.prisma.campaign.update({
            where: { id: campaignId },
            data: {
              paymentAuthorizedAt: now,
              stripePaymentIntentId: paymentIntent.id,
              activationGracePeriodEndsAt: gracePeriodEnd,
            },
          });

          this.logger.log(`Campaign ${campaignId} payment authorized (PI: ${paymentIntent.id}), grace period ends at ${gracePeriodEnd.toISOString()}`);
        } else {
          this.logger.warn(`Campaign ${campaignId} has different PI (${campaign.stripePaymentIntentId}), skipping PI ${paymentIntent.id}`);
        }
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'PAYMENT_INTENT_CAPTURABLE', {
      paymentIntentId: paymentIntent.id,
      campaignId: campaignId || null,
      amountCapturable: paymentIntent.amount_capturable / 100,
      amount: paymentIntent.amount / 100,
    });
  }

  // ==========================================================================
  // Transfer Webhooks
  // ==========================================================================

  async handleTransferCreated(transfer: Stripe.Transfer) {
    await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_CREATED', {
      transferId: transfer.id,
      amount: transfer.amount / 100,
      destination: transfer.destination,
      metadata: transfer.metadata,
    });
  }

  async handleTransferUpdated(transfer: Stripe.Transfer) {
    // Stripe sends transfer.updated for all status changes (pending → paid, failed, reversed)
    const transaction = await this.prisma.transaction.findFirst({
      where: { stripeTransferId: transfer.id },
    });

    if (transaction) {
      // Case 1: Transfer reversed → mark REFUNDED (actual reversal handled by transfer.reversed event)
      if (transfer.reversed && transaction.status !== TransactionStatus.REFUNDED) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: TransactionStatus.REFUNDED },
        });
        this.logger.log(`Transaction ${transaction.id} marked REFUNDED (transfer ${transfer.id} reversed via update)`);
      }
      // Case 2: Transfer confirmed paid → ensure transaction is COMPLETED
      else if (!transfer.reversed && transaction.status === TransactionStatus.PENDING) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: TransactionStatus.COMPLETED },
        });
        this.logger.log(`Transaction ${transaction.id} confirmed COMPLETED (transfer ${transfer.id} paid via update)`);
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_UPDATED', {
      transferId: transfer.id,
      reversed: transfer.reversed,
      transactionId: transaction?.id || null,
    });
  }

  async handleTransferFailed(transfer: Stripe.Transfer) {
    this.logger.error(`Transfer failed: ${transfer.id}`, {
      destination: transfer.destination,
      amount: transfer.amount,
      metadata: transfer.metadata,
    });

    const amountEur = transfer.amount / 100;

    // 1. Find and update the Transaction record
    const transaction = await this.prisma.transaction.findFirst({
      where: { stripeTransferId: transfer.id },
      include: { wallet: true },
    });

    if (transaction) {
      await this.prisma.$transaction(async (tx) => {
        // Mark transaction as FAILED
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: TransactionStatus.FAILED },
        });

        // Rollback wallet credit
        if (transaction.walletId) {
          await tx.wallet.update({
            where: { id: transaction.walletId },
            data: {
              balance: { decrement: new Decimal(amountEur) },
              totalEarned: { decrement: new Decimal(amountEur) },
            },
          });
        }

        // Find the associated COMMISSION transaction for this session
        let commissionAmount = 0;
        if (transaction.sessionId) {
          const commissionTx = await tx.transaction.findFirst({
            where: {
              sessionId: transaction.sessionId,
              type: TransactionType.COMMISSION,
              status: TransactionStatus.COMPLETED,
            },
          });
          if (commissionTx) {
            commissionAmount = Number(commissionTx.amount);
            // Also mark commission as FAILED
            await tx.transaction.update({
              where: { id: commissionTx.id },
              data: { status: TransactionStatus.FAILED },
            });
          }
        }

        // Rollback PlatformWallet (put money back in escrow)
        const platformWallet = await tx.platformWallet.findFirst();
        if (platformWallet) {
          await tx.platformWallet.update({
            where: { id: platformWallet.id },
            data: {
              escrowBalance: { increment: new Decimal(amountEur + commissionAmount) },
              totalTransferred: { decrement: new Decimal(amountEur) },
              totalCommissions: { decrement: new Decimal(commissionAmount) },
              commissionBalance: { decrement: new Decimal(commissionAmount) },
            },
          });
        }
      });

      this.logger.log(`Transaction ${transaction.id} marked FAILED + wallet rolled back + commission reversed (transfer ${transfer.id})`);
    }

    // 2. Find session and notify
    const sessionId = transfer.metadata?.sessionId;
    if (sessionId) {
      const session = await this.prisma.testSession.findUnique({
        where: { id: sessionId },
        include: { tester: true, campaign: { include: { seller: true } } },
      });

      if (session) {
        await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_FAILED', {
          transferId: transfer.id,
          sessionId,
          testerId: session.testerId,
          sellerId: session.campaign.sellerId,
          amount: amountEur,
          transactionId: transaction?.id || null,
          walletRolledBack: !!transaction?.walletId,
        });

        // Notify tester
        await this.notificationsService.queueEmail({
          to: session.tester.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Échec du transfert de paiement',
          variables: {
            firstName: session.tester.firstName,
            message: `Le transfert de ${amountEur}€ pour votre test "${session.campaign.title}" a échoué. Notre équipe a été notifiée et vous contactera prochainement.`,
          },
          metadata: {
            sessionId,
            type: NotificationType.SYSTEM_ALERT,
          },
        });

        // Notify PRO
        await this.notificationsService.queueEmail({
          to: session.campaign.seller.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Échec du transfert au testeur',
          variables: {
            firstName: session.campaign.seller.firstName,
            message: `Le transfert au testeur pour la campagne "${session.campaign.title}" a échoué. L'équipe support a été notifiée.`,
          },
          metadata: {
            sessionId,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }
    } else if (!transaction) {
      // No session ID and no transaction found — just audit
      await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_FAILED', {
        transferId: transfer.id,
        amount: amountEur,
        metadata: transfer.metadata,
      });
    }
  }

  async handleTransferReversed(transfer: Stripe.Transfer) {
    const amountEur = transfer.amount / 100;

    // Find the Transaction linked to this transfer
    const transaction = await this.prisma.transaction.findFirst({
      where: { stripeTransferId: transfer.id },
      include: { wallet: true },
    });

    if (transaction && transaction.status !== TransactionStatus.REFUNDED) {
      await this.prisma.$transaction(async (tx) => {
        // Mark transaction as REFUNDED
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: TransactionStatus.REFUNDED },
        });

        // Deduct from tester wallet
        if (transaction.walletId) {
          await tx.wallet.update({
            where: { id: transaction.walletId },
            data: {
              balance: { decrement: new Decimal(amountEur) },
              totalEarned: { decrement: new Decimal(amountEur) },
            },
          });
        }

        // Find and reverse the associated COMMISSION transaction
        let commissionAmount = 0;
        if (transaction.sessionId) {
          const commissionTx = await tx.transaction.findFirst({
            where: {
              sessionId: transaction.sessionId,
              type: TransactionType.COMMISSION,
              status: TransactionStatus.COMPLETED,
            },
          });
          if (commissionTx) {
            commissionAmount = Number(commissionTx.amount);
            await tx.transaction.update({
              where: { id: commissionTx.id },
              data: { status: TransactionStatus.REFUNDED },
            });
          }
        }

        // Create a reversal transaction for audit trail
        await tx.transaction.create({
          data: {
            walletId: transaction.walletId,
            type: TransactionType.REFUND,
            amount: new Decimal(amountEur),
            reason: `Reversal: ${transaction.reason}`,
            sessionId: transaction.sessionId,
            campaignId: transaction.campaignId,
            stripeTransferId: transfer.id,
            status: TransactionStatus.COMPLETED,
            metadata: {
              originalTransactionId: transaction.id,
              reversalReason: 'transfer_reversed',
              commissionReversed: commissionAmount,
            },
          },
        });

        // Restore PlatformWallet escrow + reverse commission
        const platformWallet = await tx.platformWallet.findFirst();
        if (platformWallet) {
          await tx.platformWallet.update({
            where: { id: platformWallet.id },
            data: {
              escrowBalance: { increment: new Decimal(amountEur + commissionAmount) },
              totalTransferred: { decrement: new Decimal(amountEur) },
              totalCommissions: { decrement: new Decimal(commissionAmount) },
              commissionBalance: { decrement: new Decimal(commissionAmount) },
            },
          });
        }
      });

      this.logger.log(`Transfer ${transfer.id} reversed — Transaction ${transaction.id} marked REFUNDED + wallet + commission rolled back`);
    }

    // Notify tester and PRO
    const sessionId = transfer.metadata?.sessionId;
    if (sessionId) {
      const session = await this.prisma.testSession.findUnique({
        where: { id: sessionId },
        include: { tester: true, campaign: { include: { seller: true } } },
      });

      if (session) {
        await this.notificationsService.queueEmail({
          to: session.tester.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Transfert annulé',
          variables: {
            firstName: session.tester.firstName,
            message: `Le transfert de ${amountEur}€ pour "${session.campaign.title}" a été annulé. Veuillez contacter le support pour plus d'informations.`,
          },
          metadata: { sessionId, type: NotificationType.SYSTEM_ALERT },
        });

        await this.notificationsService.queueEmail({
          to: session.campaign.seller.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Transfert annulé au testeur',
          variables: {
            firstName: session.campaign.seller.firstName,
            message: `Le transfert au testeur pour "${session.campaign.title}" a été annulé (reversal). L'équipe support a été notifiée.`,
          },
          metadata: { sessionId, type: NotificationType.SYSTEM_ALERT },
        });
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_REVERSED', {
      transferId: transfer.id,
      amount: amountEur,
      transactionId: transaction?.id || null,
      walletRolledBack: !!transaction?.walletId,
    });
  }

  // ==========================================================================
  // Refund Webhooks
  // ==========================================================================

  async handleChargeRefunded(charge: Stripe.Charge) {
    const amountRefunded = charge.amount_refunded / 100;
    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;

    // Find the campaign transaction linked to this charge's PaymentIntent
    if (paymentIntentId) {
      const transaction = await this.prisma.transaction.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      if (transaction && transaction.status !== TransactionStatus.REFUNDED) {
        // Check if fully or partially refunded
        const isFullRefund = charge.amount_refunded >= charge.amount;

        await this.prisma.$transaction(async (tx) => {
          // Update the original transaction
          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: isFullRefund ? TransactionStatus.REFUNDED : transaction.status,
              stripeRefundId: charge.refunds?.data?.[0]?.id ?? null,
            },
          });

          // Update PlatformWallet — return escrow
          const platformWallet = await tx.platformWallet.findFirst();
          if (platformWallet) {
            await tx.platformWallet.update({
              where: { id: platformWallet.id },
              data: {
                escrowBalance: { decrement: new Decimal(amountRefunded) },
                totalReceived: { decrement: new Decimal(amountRefunded) },
              },
            });
          }
        });

        this.logger.log(`Charge ${charge.id} refunded ${amountRefunded}€ — Transaction ${transaction.id} updated`);
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'CHARGE_REFUNDED', {
      chargeId: charge.id,
      amountRefunded,
      paymentIntentId,
    });
  }

  async handleRefundCreated(refund: Stripe.Refund) {
    const amountEur = (refund.amount ?? 0) / 100;

    // Link refund to transaction if possible
    const paymentIntentId = typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : (refund.payment_intent as any)?.id ?? null;

    if (paymentIntentId) {
      const transaction = await this.prisma.transaction.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      if (transaction) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { stripeRefundId: refund.id },
        });
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'REFUND_CREATED', {
      refundId: refund.id,
      amount: amountEur,
      reason: refund.reason,
      status: refund.status,
      paymentIntentId,
    });
  }

  async handleRefundUpdated(refund: Stripe.Refund) {
    // If refund succeeded, update transaction status
    if (refund.status === 'succeeded') {
      const paymentIntentId = typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : (refund.payment_intent as any)?.id ?? null;

      if (paymentIntentId) {
        const transaction = await this.prisma.transaction.findFirst({
          where: { stripePaymentIntentId: paymentIntentId },
        });

        if (transaction && transaction.status !== TransactionStatus.REFUNDED) {
          await this.prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: TransactionStatus.REFUNDED },
          });
          this.logger.log(`Transaction ${transaction.id} marked REFUNDED (refund ${refund.id} succeeded)`);
        }
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'REFUND_UPDATED', {
      refundId: refund.id,
      status: refund.status,
    });
  }

  async handleRefundFailed(refund: Stripe.Refund) {
    const amountEur = (refund.amount ?? 0) / 100;

    this.logger.error(`Refund failed: ${refund.id}`, {
      amount: amountEur,
      failureReason: refund.failure_reason,
    });

    // Notify the campaign seller if linked
    const paymentIntentId = typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : (refund.payment_intent as any)?.id ?? null;

    if (paymentIntentId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        include: { seller: true },
      });

      if (campaign) {
        await this.notificationsService.queueEmail({
          to: campaign.seller.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Échec du remboursement',
          variables: {
            firstName: campaign.seller.firstName,
            message: `Le remboursement de ${amountEur}€ pour la campagne "${campaign.title}" a échoué. Notre équipe a été notifiée.`,
          },
          metadata: {
            campaignId: campaign.id,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }
    }

    await this.auditService.log(null, AuditCategory.WALLET, 'REFUND_FAILED', {
      refundId: refund.id,
      amount: amountEur,
      failureReason: refund.failure_reason,
      paymentIntentId,
    });
  }

  // ==========================================================================
  // Payout Webhooks (Retraits IBAN)
  // ==========================================================================

  async handlePayoutCreated(payout: Stripe.Payout, event: Stripe.Event) {
    await this.auditService.log(null, AuditCategory.WALLET, 'PAYOUT_CREATED', {
      payoutId: payout.id,
      amount: payout.amount / 100,
      accountId: event.account,
    });
  }

  async handlePayoutPaid(payout: Stripe.Payout) {
    const withdrawalId = payout.metadata?.withdrawalId;
    if (withdrawalId) {
      // Mettre à jour Withdrawal
      const withdrawal = await this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: WithdrawalStatus.COMPLETED,
          completedAt: new Date(),
        },
        include: { user: true },
      });

      // Audit
      await this.auditService.log(withdrawal.userId, AuditCategory.WALLET, 'PAYOUT_PAID', {
        payoutId: payout.id,
        withdrawalId,
        amount: payout.amount / 100,
      });

      // Notification
      await this.notificationsService.queueEmail({
        to: withdrawal.user.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Withdrawal Completed',
        variables: {
          firstName: withdrawal.user.firstName,
          amount: Number(withdrawal.amount),
          message: `Your withdrawal of ${withdrawal.amount}€ has been completed. The funds should appear in your bank account within 2-3 business days.`,
        },
        metadata: {
          withdrawalId,
          type: NotificationType.PAYMENT_RECEIVED,
        },
      });
    }
  }

  async handlePayoutFailed(payout: Stripe.Payout) {
    const withdrawalId = payout.metadata?.withdrawalId;
    if (withdrawalId) {
      // Mettre à jour Withdrawal + rendre balance
      const withdrawal = await this.prisma.$transaction(async (tx) => {
        const withdrawal = await tx.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: WithdrawalStatus.FAILED,
            failureReason: payout.failure_message,
          },
          include: { user: true },
        });

        // Rendre le montant au wallet
        await tx.wallet.update({
          where: { userId: withdrawal.userId },
          data: {
            balance: {
              increment: withdrawal.amount,
            },
          },
        });

        return withdrawal;
      });

      // Audit
      await this.auditService.log(withdrawal.userId, AuditCategory.WALLET, 'PAYOUT_FAILED', {
        payoutId: payout.id,
        withdrawalId,
        amount: payout.amount / 100,
        failureCode: payout.failure_code,
        failureMessage: payout.failure_message,
      });

      // Notification
      await this.notificationsService.queueEmail({
        to: withdrawal.user.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Withdrawal Failed',
        variables: {
          firstName: withdrawal.user.firstName,
          amount: Number(withdrawal.amount),
          message: `Your withdrawal of ${withdrawal.amount}€ failed. The amount has been returned to your wallet. Please contact support if this persists.`,
        },
        metadata: {
          withdrawalId,
          type: NotificationType.SYSTEM_ALERT,
        },
      });
    }
  }

  async handlePayoutCanceled(payout: Stripe.Payout) {
    const withdrawalId = payout.metadata?.withdrawalId;
    if (withdrawalId) {
      // Mettre à jour Withdrawal + rendre balance
      await this.prisma.$transaction(async (tx) => {
        const withdrawal = await tx.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: WithdrawalStatus.CANCELLED,
          },
        });

        await tx.wallet.update({
          where: { userId: withdrawal.userId },
          data: {
            balance: {
              increment: withdrawal.amount,
            },
          },
        });
      });

      await this.auditService.log(null, AuditCategory.WALLET, 'PAYOUT_CANCELED', {
        payoutId: payout.id,
        withdrawalId,
      });
    }
  }

  async handlePayoutUpdated(payout: Stripe.Payout) {
    await this.auditService.log(null, AuditCategory.WALLET, 'PAYOUT_UPDATED', {
      payoutId: payout.id,
      status: payout.status,
    });
  }
}
