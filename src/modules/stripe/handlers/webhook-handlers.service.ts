import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  AuditCategory,
  NotificationType,
  CampaignStatus,
  WithdrawalStatus,
} from '@prisma/client';
import { NotificationTemplate } from '../../notifications/enums/notification-template.enum';
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
  ) {}

  // ==========================================================================
  // Account Webhooks (Onboarding PRO + TESTEUR)
  // ==========================================================================

  async handleAccountUpdated(account: Stripe.Account) {
    const profile = await this.prisma.profile.findUnique({
      where: { stripeConnectAccountId: account.id },
      select: { id: true, email: true, firstName: true, stripeOnboardingCompleted: true, role: true },
    });

    if (!profile) {
      this.logger.warn(`Profile not found for Stripe account ${account.id}`);
      return;
    }

    const wasCompleted = profile.stripeOnboardingCompleted;
    const isNowCompleted = account.charges_enabled && account.details_submitted;

    // Mettre à jour Profile pour PRO et TESTEUR quand l'onboarding Connect est complété
    if (!wasCompleted && isNowCompleted) {
      await this.prisma.profile.update({
        where: { stripeConnectAccountId: account.id },
        data: { stripeOnboardingCompleted: true },
      });

      // Audit log
      await this.auditService.log(profile.id, AuditCategory.USER, 'STRIPE_ONBOARDING_COMPLETED', {
        stripeAccountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        role: profile.role,
      });

      // Notification
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
    this.logger.log(`🔔 WEBHOOK RECEIVED: identity.verification_session.verified - Session ID: ${session.id}`);
    this.logger.log(`📋 Session metadata: ${JSON.stringify(session.metadata)}`);

    const profileId = session.metadata?.profileId;

    if (!profileId) {
      this.logger.error(`❌ No profileId in verification session ${session.id} - Metadata: ${JSON.stringify(session.metadata)}`);
      return;
    }

    this.logger.log(`✅ Found profileId: ${profileId}`);

    const testerProfile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true, email: true, firstName: true, stripeIdentityVerified: true },
    });

    if (!testerProfile) {
      this.logger.warn(`Profile not found for ID ${profileId}`);
      return;
    }

    if (!testerProfile.stripeIdentityVerified) {
      await this.prisma.profile.update({
        where: { id: profileId },
        data: {
          stripeIdentityVerified: true,
          stripeOnboardingCompleted: true, // Auto-set car Identity > Onboarding
        },
      });

      // Audit log
      await this.auditService.log(profileId, AuditCategory.USER, 'STRIPE_IDENTITY_VERIFIED', {
        verificationSessionId: session.id,
        status: session.status,
      });

      // Notification
      await this.notificationsService.queueEmail({
        to: testerProfile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Identity Verification Completed',
        variables: {
          firstName: testerProfile.firstName,
          message: 'Your identity has been verified. You can now apply to campaigns and receive payments.',
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
      // Bloquer le user temporairement
      await this.prisma.profile.update({
        where: { id: profileId },
        data: {
          stripeIdentityVerified: false,
        },
      });

      // Audit
      await this.auditService.log(profileId, AuditCategory.USER, 'STRIPE_IDENTITY_REQUIRES_INPUT', {
        verificationSessionId: session.id,
        lastError: session.last_error,
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
        select: { id: true, title: true, sellerId: true, status: true },
      });

      if (campaign && campaign.status === CampaignStatus.PENDING_PAYMENT) {
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
    await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_UPDATED', {
      transferId: transfer.id,
    });
  }

  async handleTransferPaid(transfer: Stripe.Transfer) {
    await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_PAID', {
      transferId: transfer.id,
      amount: transfer.amount / 100,
      destination: transfer.destination,
    });
  }

  async handleTransferFailed(transfer: Stripe.Transfer) {
    // Logger l'erreur
    this.logger.error(`Transfer failed: ${transfer.id}`, {
      destination: transfer.destination,
      amount: transfer.amount,
      metadata: transfer.metadata,
    });

    // Trouver la session ou transaction associée
    const sessionId = transfer.metadata?.sessionId;
    if (sessionId) {
      const session = await this.prisma.testSession.findUnique({
        where: { id: sessionId },
        include: { tester: true, campaign: { include: { seller: true } } },
      });

      if (session) {
        // Audit
        await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_FAILED', {
          transferId: transfer.id,
          sessionId,
          testerId: session.testerId,
          sellerId: session.campaign.sellerId,
          amount: transfer.amount / 100,
        });

        // Notifier TESTEUR
        await this.notificationsService.queueEmail({
          to: session.tester.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Payment Transfer Failed',
          variables: {
            firstName: session.tester.firstName,
            message: 'There was an issue processing your payment. Our team has been notified and will contact you shortly.',
          },
          metadata: {
            sessionId,
            type: NotificationType.SYSTEM_ALERT,
          },
        });

        // Notifier PRO
        await this.notificationsService.queueEmail({
          to: session.campaign.seller.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Transfer Failed',
          variables: {
            firstName: session.campaign.seller.firstName,
            message: `Transfer failed for test session. Support team notified.`,
          },
          metadata: {
            sessionId,
            type: NotificationType.SYSTEM_ALERT,
          },
        });
      }
    }
  }

  async handleTransferReversed(transfer: Stripe.Transfer) {
    await this.auditService.log(null, AuditCategory.WALLET, 'TRANSFER_REVERSED', {
      transferId: transfer.id,
      amount: transfer.amount / 100,
    });
  }

  // ==========================================================================
  // Refund Webhooks
  // ==========================================================================

  async handleChargeRefunded(charge: Stripe.Charge) {
    await this.auditService.log(null, AuditCategory.WALLET, 'CHARGE_REFUNDED', {
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded / 100,
    });
  }

  async handleRefundCreated(refund: Stripe.Refund) {
    await this.auditService.log(null, AuditCategory.WALLET, 'REFUND_CREATED', {
      refundId: refund.id,
      amount: refund.amount / 100,
      reason: refund.reason,
    });
  }

  async handleRefundUpdated(refund: Stripe.Refund) {
    await this.auditService.log(null, AuditCategory.WALLET, 'REFUND_UPDATED', {
      refundId: refund.id,
      status: refund.status,
    });
  }

  async handleRefundFailed(refund: Stripe.Refund) {
    this.logger.error(`Refund failed: ${refund.id}`, {
      amount: refund.amount,
      failureReason: refund.failure_reason,
    });

    await this.auditService.log(null, AuditCategory.WALLET, 'REFUND_FAILED', {
      refundId: refund.id,
      amount: refund.amount / 100,
      failureReason: refund.failure_reason,
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
