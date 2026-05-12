import {
  Injectable,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from '../wallet/wallet.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { PostHogService } from '../posthog/posthog.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import {
  Campaign,
  Transaction,
  TransactionType,
  TransactionStatus,
  AuditCategory,
  NotificationType,
  CampaignStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import Stripe from 'stripe';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly walletService: WalletService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly posthog: PostHogService,
  ) {}

  // ============================================================================
  // Campaign Escrow Calculation
  // ============================================================================

  async calculateCampaignEscrow(campaignId: string, userId?: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { offers: true },
    });

    if (!campaign || !campaign.offers || campaign.offers.length === 0) {
      throw new I18nHttpException('payment.campaign_not_found', 'PAYMENT_CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Si userId fourni, vérifier ownership (PRO owner ou ADMIN)
    if (userId) {
      const user = await this.prisma.profile.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });

      if (user?.role !== 'ADMIN' && campaign.sellerId !== userId) {
        throw new I18nHttpException('payment.not_authorized', 'PAYMENT_NOT_AUTHORIZED', HttpStatus.FORBIDDEN);
      }
    }

    const rules = await this.businessRulesService.findLatest();

    const offer = campaign.offers[0];
    const productCost = Number(offer.maxReimbursedPrice ?? offer.expectedPrice);
    const shippingCost = Number(offer.maxReimbursedShipping ?? offer.shippingCost);
    const testerBonus = rules.testerBonus;
    const proBonus = Number(offer.bonus ?? 0);

    // baseCost = produit + livraison + bonus testeur + bonus PRO (SANS commission ni Stripe)
    // Note: supertryCommission et commissionFixedFee sont le MÊME frais (5€).
    // On ne l'inclut PAS ici car calculateCommission() l'ajoute via commissionFixedFee.
    const baseCostWithoutCommission = productCost + shippingCost + testerBonus + proBonus;

    // Calcul via BusinessRules: commission fixe SuperTry + couverture Stripe
    const { commissionFixedFee, stripeFeePercent, stripeCoverage, totalPerTester } =
      await this.businessRulesService.calculateCommission(baseCostWithoutCommission);

    const totalSlots = campaign.totalSlots;
    const totalAmount = Math.round(totalPerTester * totalSlots * 100) / 100;

    // Format helper: "12,99 €"
    const fmt = (n: number) =>
      n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

    // Pourcentage Stripe lisible: 0.035 → "3,5"
    const stripePctLabel = (stripeFeePercent * 100)
      .toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

    return {
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      totalSlots,

      // ── Lignes prêtes à afficher côté frontend ──
      // Le frontend itère sur displayLines et affiche label + amount tel quel
      displayLines: [
        { label: 'Remboursement produit', amount: fmt(productCost) },
        { label: 'Frais de port', amount: fmt(shippingCost) },
        { label: 'Bonus testeur', amount: fmt(testerBonus) },
        { label: 'Bonus PRO', amount: fmt(proBonus) },
        { label: 'Commission SuperTry', amount: fmt(commissionFixedFee) },
        { label: `Couverture Stripe (${stripePctLabel}%)`, amount: fmt(stripeCoverage) },
      ],
      subtotalPerTester: {
        label: 'Sous-total / testeur',
        amount: fmt(totalPerTester),
      },
      total: {
        label: `TOTAL (${totalSlots} testeur${totalSlots > 1 ? 's' : ''})`,
        detail: `${totalSlots} × ${fmt(totalPerTester)}`,
        amount: fmt(totalAmount),
      },

      // ── Champs bruts (utilisés en interne par processCampaignPayment, refundUnusedSlots, etc.) ──
      productCost,
      shippingCost,
      testerBonus,
      platformCommission: testerBonus + commissionFixedFee,
      proBonus,
      supertryCommission: commissionFixedFee,
      stripeCoverage,
      perTester: totalPerTester,
      totalAmount,
    };
  }

  // ============================================================================
  // Campaign Payment Processing
  // ============================================================================

  async processCampaignPayment(
    campaignId: string,
    userId: string,
    paymentMethodId: string,
  ): Promise<{
    paymentIntent: Stripe.PaymentIntent;
    transaction: Transaction;
    campaign: Campaign;
  }> {
    // Get campaign and seller info
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        offers: true,
      },
    });

    if (!campaign) {
      throw new I18nHttpException('payment.campaign_not_found', 'PAYMENT_CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (campaign.sellerId !== userId) {
      throw new I18nHttpException('payment.not_authorized', 'PAYMENT_NOT_AUTHORIZED', HttpStatus.FORBIDDEN);
    }

    // Idempotency: block payment if campaign is not in DRAFT status
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new I18nHttpException('payment.already_in_status', 'PAYMENT_ALREADY_IN_STATUS', HttpStatus.BAD_REQUEST, { status: campaign.status });
    }

    // Idempotency: block if a PaymentIntent already exists for this campaign
    if (campaign.stripePaymentIntentId) {
      throw new I18nHttpException('payment.already_initiated', 'PAYMENT_ALREADY_INITIATED', HttpStatus.BAD_REQUEST);
    }

    // Calculate escrow
    const escrow = await this.calculateCampaignEscrow(campaignId);

    this.logger.log(`Processing payment for campaign ${campaignId}: ${escrow.totalAmount}€`);

    // Create Stripe PaymentIntent
    const paymentIntent = await this.stripeService.createPaymentIntent(escrow.totalAmount, 'eur', {
      campaignId,
      sellerId: userId,
      totalSlots: campaign.totalSlots.toString(),
      perTester: escrow.perTester.toString(),
    }, {
      description: `SuperTry campaign: ${campaign.title} (${campaign.totalSlots} testers)`,
      statementDescriptor: 'SUPERTRY CAMPAIGN',
      transferGroup: `campaign_${campaignId}`,
    });

    // Confirm payment
    const confirmedPayment = await this.stripeService.confirmPaymentIntent(
      paymentIntent.id,
      paymentMethodId,
    );

    if (confirmedPayment.status !== 'succeeded') {
      throw new I18nHttpException('payment.confirmation_failed', 'PAYMENT_CONFIRMATION_FAILED', HttpStatus.BAD_REQUEST);
    }

    // Separate Charges and Transfers: Argent va sur PlatformWallet
    const result = await this.prisma.$transaction(async (tx) => {
      // Transaction PLATEFORME (walletId: null)
      const transaction = await tx.transaction.create({
        data: {
          walletId: null, // PLATEFORME
          type: TransactionType.CAMPAIGN_PAYMENT,
          amount: new Decimal(escrow.totalAmount),
          reason: `Campaign payment for: ${campaign.title}`,
          campaignId,
          stripePaymentIntentId: confirmedPayment.id,
          status: TransactionStatus.COMPLETED,
          metadata: {
            escrowBreakdown: escrow,
            perTester: escrow.perTester,
            totalSlots: campaign.totalSlots,
          },
        },
      });

      // Créer PlatformWallet si n'existe pas
      let platformWallet = await tx.platformWallet.findFirst();
      if (!platformWallet) {
        platformWallet = await tx.platformWallet.create({
          data: {
            escrowBalance: 0,
            commissionBalance: 0,
            totalReceived: 0,
            totalTransferred: 0,
            totalCommissions: 0,
          },
        });
      }

      // Update PlatformWallet: ajouter à l'escrow
      await tx.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: {
            increment: new Decimal(escrow.totalAmount),
          },
          totalReceived: {
            increment: new Decimal(escrow.totalAmount),
          },
        },
      });

      // Calculer la fin de la grace period (1h par défaut)
      const gracePeriodMinutes =
        await this.businessRulesService.getCampaignActivationGracePeriodMinutes();
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setMinutes(gracePeriodEnd.getMinutes() + gracePeriodMinutes);

      // Update campaign status to PENDING_ACTIVATION with grace period
      const updatedCampaign = await tx.campaign.update({
        where: { id: campaignId },
        data: {
          status: CampaignStatus.PENDING_ACTIVATION,
          stripePaymentIntentId: confirmedPayment.id,
          activationGracePeriodEndsAt: gracePeriodEnd,
          paymentAuthorizedAt: new Date(),
        },
      });

      return { transaction, campaign: updatedCampaign };
    });

    // Audit log
    await this.auditService.log(
      userId,
      AuditCategory.WALLET,
      'CAMPAIGN_PAYMENT_PROCESSED',
      {
        campaignId,
        amount: escrow.totalAmount,
        stripePaymentIntentId: confirmedPayment.id,
        escrowBreakdown: escrow,
      },
    );

    // Get seller for notification
    const sellerProfile = await this.prisma.profile.findUnique({
      where: { id: campaign.sellerId },
      select: { id: true, email: true, firstName: true },
    });

    // Send notification to PRO
    this.notificationsService.tryQueueEmail({
      to: sellerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Campaign Payment Confirmed',
      variables: {
        firstName: sellerProfile!.firstName,
        campaignTitle: campaign.title,
        amount: escrow.totalAmount,
        totalSlots: campaign.totalSlots,
        message: `Your payment of ${escrow.totalAmount}€ has been processed successfully. Your campaign is now active!`,
      },
      metadata: {
        campaignId,
        transactionId: result.transaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    this.logger.log(`Campaign payment processed successfully: ${campaignId}`);

    this.posthog.capture(userId, 'payment_completed', {
      campaignId,
      transactionId: result.transaction.id,
      amountEur: Number(result.transaction.amount),
      stripeIntentId: confirmedPayment.id,
    });

    return {
      paymentIntent: confirmedPayment,
      transaction: result.transaction,
      campaign: result.campaign,
    };
  }

  // ============================================================================
  // Test Session Completion Payment
  // ============================================================================

  // ============================================================================
  // Purchase Reimbursement (called at PURCHASE_VALIDATED)
  // Transfers productPrice + shippingCost to tester
  // ============================================================================

  async processPurchaseReimbursement(sessionId: string): Promise<{
    testerTransfer: Stripe.Transfer;
    testerTransaction: Transaction;
  }> {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: {
          select: {
            id: true,
            title: true,
            sellerId: true,
            stripePaymentIntentId: true,
          },
        },
      },
    });

    if (!session) {
      throw new I18nHttpException('session.not_found', 'SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Idempotency guard: already reimbursed
    if (session.purchaseReimbursedAt) {
      this.logger.warn(`Purchase reimbursement already processed for session ${sessionId}`);
      return null as any;
    }

    const testerProfile = await this.prisma.profile.findUnique({
      where: { id: session.testerId },
      select: { id: true, email: true, firstName: true, stripeConnectAccountId: true, stripeIdentityVerified: true, completedSessionsCount: true },
    });

    // Get business rules
    const rules = await this.businessRulesService.findLatest();

    // Cap reimbursement to max allowed by offer (safety net)
    const offer = await this.prisma.offer.findFirst({
      where: { campaignId: session.campaignId },
      select: { expectedPrice: true, shippingCost: true, maxReimbursedPrice: true, maxReimbursedShipping: true },
    });
    const maxPrice = offer ? Number(offer.maxReimbursedPrice ?? offer.expectedPrice) : Infinity;
    const maxShipping = offer ? Number(offer.maxReimbursedShipping ?? offer.shippingCost) : Infinity;

    const productCost = Math.min(Number(session.productPrice), maxPrice);
    const shippingCost = Math.min(Number(session.shippingCost), maxShipping);
    const reimbursementAmount = productCost + shippingCost;

    // Vérifier Stripe Connect account
    const testerStripeAccount = testerProfile?.stripeConnectAccountId;
    if (!testerStripeAccount) {
      throw new I18nHttpException('payment.tester_no_stripe', 'PAYMENT_TESTER_NO_STRIPE', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // KYC check
    const kycThreshold = rules.kycRequiredAfterTests ?? 3;
    const completedCount = testerProfile?.completedSessionsCount ?? 0;
    if (completedCount >= kycThreshold && !testerProfile?.stripeIdentityVerified) {
      throw new I18nHttpException('payment.kyc_required', 'PAYMENT_KYC_REQUIRED', HttpStatus.BAD_REQUEST, { threshold: kycThreshold }, { identityRequired: true });
    }

    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.logger.log(`💰 PURCHASE REIMBURSEMENT FOR SESSION ${sessionId}`);
    this.logger.log(`   Product Cost: ${productCost}€`);
    this.logger.log(`   Shipping Cost: ${shippingCost}€`);
    this.logger.log(`   TOTAL: ${reimbursementAmount}€`);
    this.logger.log(`   Tester Stripe Account: ${testerStripeAccount}`);
    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Create wallet for tester if doesn't exist
    await this.walletService.createWallet(session.testerId);

    // Stripe Transfer: PLATEFORME → TESTEUR
    let testerTransfer: any = null;
    try {
      testerTransfer = await this.stripeService.createPlatformToConnectTransfer(
        reimbursementAmount,
        testerStripeAccount,
        'eur',
        {
          platform: 'supertry',
          env: process.env.NODE_ENV || 'development',
          transactionType: 'PURCHASE_REIMBURSEMENT',
          sessionId,
          campaignId: session.campaignId,
          campaignTitle: session.campaign.title,
          testerId: session.testerId,
          testerEmail: testerProfile?.email || 'N/A',
          testerName: testerProfile?.firstName || 'N/A',
          productCost: productCost.toFixed(2),
          shippingCost: shippingCost.toFixed(2),
          totalReimbursement: reimbursementAmount.toFixed(2),
          createdAt: new Date().toISOString(),
        },
        `Purchase reimbursement: ${session.campaign.title} - ${testerProfile?.firstName || 'Tester'}`,
        `campaign_${session.campaignId}`,
      );
      this.logger.log(`✅ Purchase reimbursement transfer: ${testerTransfer.id} - ${reimbursementAmount}€ → ${testerStripeAccount}`);
    } catch (error) {
      this.logger.error(`❌ PURCHASE REIMBURSEMENT TRANSFER FAILED - Session ${sessionId}: ${error.message}`);

      await this.auditService.log(
        null,
        AuditCategory.WALLET,
        'TRANSFER_FAILED',
        {
          sessionId,
          testerId: session.testerId,
          amount: reimbursementAmount,
          type: 'PURCHASE_REIMBURSEMENT',
          error: error.message,
          errorType: error.type,
          errorCode: error.code,
        },
      );

      throw new I18nHttpException('payment.transfer_failed', 'PAYMENT_TRANSFER_FAILED', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // DB transaction: create transaction + update wallets + mark session
    const result = await this.prisma.$transaction(async (tx) => {
      let testerWallet = await tx.wallet.findUnique({
        where: { userId: session.testerId },
      });

      if (!testerWallet) {
        testerWallet = await tx.wallet.create({
          data: {
            userId: session.testerId,
            balance: 0,
            pendingBalance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
          },
        });
      }

      const testerTransaction = await tx.transaction.create({
        data: {
          walletId: testerWallet.id,
          type: TransactionType.PURCHASE_REIMBURSEMENT,
          amount: new Decimal(reimbursementAmount),
          reason: `Purchase reimbursement: ${session.campaign.title}`,
          sessionId,
          campaignId: session.campaignId,
          stripeTransferId: testerTransfer?.id || null,
          status: TransactionStatus.COMPLETED,
          metadata: {
            productPrice: session.productPrice,
            shippingCost: session.shippingCost,
          },
        },
      });

      await tx.wallet.update({
        where: { id: testerWallet.id },
        data: {
          balance: { increment: new Decimal(reimbursementAmount) },
          totalEarned: { increment: new Decimal(reimbursementAmount) },
          lastCreditedAt: new Date(),
        },
      });

      const platformWallet = await tx.platformWallet.findFirst();
      if (!platformWallet) {
        throw new I18nHttpException('payment.platform_wallet_not_found', 'PAYMENT_PLATFORM_WALLET_NOT_FOUND', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      await tx.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: { decrement: new Decimal(reimbursementAmount) },
          totalTransferred: { increment: new Decimal(reimbursementAmount) },
        },
      });

      // Mark session as reimbursed
      await tx.testSession.update({
        where: { id: sessionId },
        data: {
          purchaseReimbursedAt: new Date(),
          purchaseReimbursementAmount: new Decimal(reimbursementAmount),
        },
      });

      return { testerTransaction };
    });

    // Audit
    await this.auditService.log(
      session.testerId,
      AuditCategory.WALLET,
      'PURCHASE_REIMBURSEMENT_CREDITED',
      {
        sessionId,
        campaignId: session.campaignId,
        reimbursementAmount,
        transactionId: result.testerTransaction.id,
        stripeTransferId: testerTransfer?.id || null,
      },
    );

    // Notify tester
    this.notificationsService.tryQueueEmail({
      to: testerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Purchase Reimbursement Received',
      variables: {
        firstName: testerProfile!.firstName || 'Tester',
        campaignTitle: session.campaign.title,
        amount: reimbursementAmount,
        message: `You've received ${reimbursementAmount}€ as reimbursement for your purchase.`,
      },
      metadata: {
        userId: session.testerId,
        sessionId,
        transactionId: result.testerTransaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    this.logger.log(`Purchase reimbursement processed: ${sessionId}`);

    return {
      testerTransfer,
      testerTransaction: result.testerTransaction,
    };
  }

  // ============================================================================
  // Bonus Payment + Commission (called at SUBMITTED / submitTest)
  // Transfers testerBonus + proBonus to tester, records SuperTry commission
  // ============================================================================

  async processBonusPayment(sessionId: string): Promise<{
    testerTransfer: Stripe.Transfer;
    testerTransaction: Transaction;
    commissionTransaction: Transaction;
  }> {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: {
          select: {
            id: true,
            title: true,
            sellerId: true,
            stripePaymentIntentId: true,
            offers: true,
          },
        },
      },
    });

    if (!session) {
      throw new I18nHttpException('session.not_found', 'SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Idempotency guard: already paid
    if (session.bonusPaidAt) {
      this.logger.warn(`Bonus already paid for session ${sessionId}`);
      return null as any;
    }

    const testerProfile = await this.prisma.profile.findUnique({
      where: { id: session.testerId },
      select: { id: true, email: true, firstName: true, stripeConnectAccountId: true, stripeIdentityVerified: true, completedSessionsCount: true },
    });

    const rules = await this.businessRulesService.findLatest();

    const testerBonus = rules.testerBonus;
    const proBonus = Number(session.campaign.offers[0].bonus ?? 0);
    const bonusAmount = testerBonus + proBonus;
    const commissionAmount = rules.supertryCommission;

    const testerStripeAccount = testerProfile?.stripeConnectAccountId;
    if (!testerStripeAccount) {
      throw new I18nHttpException('payment.tester_no_stripe', 'PAYMENT_TESTER_NO_STRIPE', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // KYC check
    const kycThreshold = rules.kycRequiredAfterTests ?? 3;
    const completedCount = testerProfile?.completedSessionsCount ?? 0;
    if (completedCount >= kycThreshold && !testerProfile?.stripeIdentityVerified) {
      throw new I18nHttpException('payment.kyc_required', 'PAYMENT_KYC_REQUIRED', HttpStatus.BAD_REQUEST, { threshold: kycThreshold }, { identityRequired: true });
    }

    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.logger.log(`💰 BONUS PAYMENT FOR SESSION ${sessionId}`);
    this.logger.log(`   Tester Fee (fixed): ${testerBonus}€`);
    this.logger.log(`   Pro Bonus: ${proBonus}€`);
    this.logger.log(`   TOTAL BONUS: ${bonusAmount}€`);
    this.logger.log(`   Commission (SuperTry): ${commissionAmount}€`);
    this.logger.log(`   Tester Stripe Account: ${testerStripeAccount}`);
    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    await this.walletService.createWallet(session.testerId);

    // Stripe Transfer: PLATEFORME → TESTEUR (bonus only)
    let testerTransfer: any = null;
    try {
      testerTransfer = await this.stripeService.createPlatformToConnectTransfer(
        bonusAmount,
        testerStripeAccount,
        'eur',
        {
          platform: 'supertry',
          env: process.env.NODE_ENV || 'development',
          transactionType: 'TEST_BONUS',
          sessionId,
          campaignId: session.campaignId,
          campaignTitle: session.campaign.title,
          testerId: session.testerId,
          testerEmail: testerProfile?.email || 'N/A',
          testerName: testerProfile?.firstName || 'N/A',
          testerFee: testerBonus.toFixed(2),
          proBonus: proBonus.toFixed(2),
          totalBonus: bonusAmount.toFixed(2),
          commissionRetained: commissionAmount.toFixed(2),
          createdAt: new Date().toISOString(),
        },
        `Test bonus: ${session.campaign.title} - ${testerProfile?.firstName || 'Tester'}`,
        `campaign_${session.campaignId}`,
      );
      this.logger.log(`✅ Bonus transfer: ${testerTransfer.id} - ${bonusAmount}€ → ${testerStripeAccount}`);
    } catch (error) {
      this.logger.error(`❌ BONUS TRANSFER FAILED - Session ${sessionId}: ${error.message}`);

      await this.auditService.log(
        null,
        AuditCategory.WALLET,
        'TRANSFER_FAILED',
        {
          sessionId,
          testerId: session.testerId,
          amount: bonusAmount,
          type: 'TEST_BONUS',
          error: error.message,
          errorType: error.type,
          errorCode: error.code,
        },
      );

      throw new I18nHttpException('payment.transfer_failed', 'PAYMENT_TRANSFER_FAILED', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // DB transaction: bonus + commission + wallet updates
    const result = await this.prisma.$transaction(async (tx) => {
      let testerWallet = await tx.wallet.findUnique({
        where: { userId: session.testerId },
      });

      if (!testerWallet) {
        testerWallet = await tx.wallet.create({
          data: {
            userId: session.testerId,
            balance: 0,
            pendingBalance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
          },
        });
      }

      // Transaction TEST_REWARD (bonus testeur)
      const testerTransaction = await tx.transaction.create({
        data: {
          walletId: testerWallet.id,
          type: TransactionType.TEST_REWARD,
          amount: new Decimal(bonusAmount),
          reason: `Test bonus: ${session.campaign.title}`,
          sessionId,
          campaignId: session.campaignId,
          stripeTransferId: testerTransfer?.id || null,
          status: TransactionStatus.COMPLETED,
          metadata: {
            testerFee: testerBonus,
            proBonus,
          },
        },
      });

      // Transaction COMMISSION (plateforme)
      const commissionTransaction = await tx.transaction.create({
        data: {
          walletId: null, // PLATEFORME
          type: TransactionType.COMMISSION,
          amount: new Decimal(commissionAmount),
          reason: `SuperTry commission: ${session.campaign.title}`,
          sessionId,
          campaignId: session.campaignId,
          status: TransactionStatus.COMPLETED,
        },
      });

      // Update tester wallet
      await tx.wallet.update({
        where: { id: testerWallet.id },
        data: {
          balance: { increment: new Decimal(bonusAmount) },
          totalEarned: { increment: new Decimal(bonusAmount) },
          lastCreditedAt: new Date(),
        },
      });

      // Update PlatformWallet
      const platformWallet = await tx.platformWallet.findFirst();
      if (!platformWallet) {
        throw new I18nHttpException('payment.platform_wallet_not_found', 'PAYMENT_PLATFORM_WALLET_NOT_FOUND', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      await tx.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: { decrement: new Decimal(bonusAmount + commissionAmount) },
          commissionBalance: { increment: new Decimal(commissionAmount) },
          totalTransferred: { increment: new Decimal(bonusAmount) },
          totalCommissions: { increment: new Decimal(commissionAmount) },
        },
      });

      // Mark session bonus as paid
      await tx.testSession.update({
        where: { id: sessionId },
        data: {
          bonusPaidAt: new Date(),
          bonusAmount: new Decimal(bonusAmount),
        },
      });

      return { testerTransaction, commissionTransaction };
    });

    // Audit logs
    await this.auditService.log(
      session.testerId,
      AuditCategory.WALLET,
      'TEST_BONUS_CREDITED',
      {
        sessionId,
        campaignId: session.campaignId,
        bonusAmount,
        transactionId: result.testerTransaction.id,
        stripeTransferId: testerTransfer?.id || null,
      },
    );

    await this.auditService.log(
      null,
      AuditCategory.WALLET,
      'COMMISSION_COLLECTED',
      {
        sessionId,
        campaignId: session.campaignId,
        commissionAmount,
        transactionId: result.commissionTransaction.id,
      },
    );

    // Notify tester
    this.notificationsService.tryQueueEmail({
      to: testerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Test Bonus Received',
      variables: {
        firstName: testerProfile!.firstName || 'Tester',
        campaignTitle: session.campaign.title,
        amount: bonusAmount,
        message: `You've received ${bonusAmount}€ bonus for submitting your test.`,
      },
      metadata: {
        userId: session.testerId,
        sessionId,
        transactionId: result.testerTransaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    this.logger.log(`Bonus payment processed: ${sessionId}`);

    return {
      testerTransfer,
      testerTransaction: result.testerTransaction,
      commissionTransaction: result.commissionTransaction,
    };
  }

  // ============================================================================
  // Refund Unused Slots
  // ============================================================================

  async refundUnusedSlots(campaignId: string): Promise<{
    unusedSlots: number;
    totalPriceDifference: number;
    refundAmount: number;
    refund: Stripe.Refund;
    transaction: Transaction;
  }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { offers: true },
    });

    if (!campaign) {
      throw new I18nHttpException('payment.campaign_not_found', 'PAYMENT_CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (!campaign.stripePaymentIntentId) {
      throw new I18nHttpException('payment.no_payment_found', 'PAYMENT_NO_PAYMENT_FOUND', HttpStatus.NOT_FOUND);
    }

    const offer = campaign.offers[0];
    if (!offer) {
      throw new I18nHttpException('payment.no_offer_found', 'PAYMENT_NO_OFFER_FOUND', HttpStatus.NOT_FOUND);
    }

    // Get seller profile, completed sessions count, and completed sessions details
    const [sellerProfile, completedSessionsCount, completedSessionsList] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { id: campaign.sellerId },
        select: { id: true, email: true, firstName: true },
      }),
      this.prisma.testSession.count({
        where: { campaignId, status: 'COMPLETED' },
      }),
      this.prisma.testSession.findMany({
        where: { campaignId, status: 'COMPLETED' },
        select: { id: true, productPrice: true, shippingCost: true },
      }),
    ]);

    const unusedSlots = campaign.totalSlots - completedSessionsCount;

    // Calculate price differences for completed sessions
    const maxProductPrice = Number(offer.maxReimbursedPrice ?? offer.expectedPrice);
    const maxShippingCost = Number(offer.maxReimbursedShipping ?? offer.shippingCost);

    const priceDifferences = completedSessionsList.map((session) => {
      const priceDiff = Math.max(0, maxProductPrice - Number(session.productPrice ?? 0));
      const shippingDiff = Math.max(0, maxShippingCost - Number(session.shippingCost ?? 0));
      return {
        sessionId: session.id,
        priceDiff: Math.round(priceDiff * 100) / 100,
        shippingDiff: Math.round(shippingDiff * 100) / 100,
        total: Math.round((priceDiff + shippingDiff) * 100) / 100,
      };
    });

    const totalPriceDifference = Math.round(
      priceDifferences.reduce((sum, d) => sum + d.total, 0) * 100,
    ) / 100;

    // Calculate refund amount: unused slots + price differences
    const escrow = await this.calculateCampaignEscrow(campaignId);
    const unusedSlotsRefund = unusedSlots > 0 ? escrow.perTester * unusedSlots : 0;
    const refundAmount = Math.round((unusedSlotsRefund + totalPriceDifference) * 100) / 100;

    if (refundAmount <= 0) {
      throw new I18nHttpException('payment.nothing_to_refund', 'PAYMENT_NOTHING_TO_REFUND', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.logger.log(`💰 CAMPAIGN END REFUND for ${campaignId}`);
    this.logger.log(`   Unused slots: ${unusedSlots} × ${escrow.perTester}€ = ${unusedSlotsRefund}€`);
    this.logger.log(`   Price differences: ${totalPriceDifference}€ (${priceDifferences.length} sessions)`);
    this.logger.log(`   TOTAL REFUND: ${refundAmount}€`);
    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Create Stripe Refund: single refund for everything
    let refund: Stripe.Refund;
    try {
      refund = await this.stripeService.createRefund(
        campaign.stripePaymentIntentId,
        refundAmount,
        'requested_by_customer',
        {
          transactionType: 'CAMPAIGN_END_REFUND',
          campaignId,
          campaignTitle: campaign.title || 'N/A',
          sellerId: campaign.sellerId,
          sellerEmail: sellerProfile?.email || 'N/A',
          unusedSlots: String(unusedSlots),
          unusedSlotsRefund: unusedSlotsRefund.toFixed(2),
          totalPriceDifference: totalPriceDifference.toFixed(2),
          totalSlots: String(campaign.totalSlots),
          completedSlots: String(completedSessionsCount),
          totalRefund: refundAmount.toFixed(2),
          createdAt: new Date().toISOString(),
        },
      );
      this.logger.log(`Refund created: ${refund.id} - ${refundAmount}€ → PRO card`);
    } catch (error) {
      this.logger.error(`Refund failed: ${error.message}`, error.stack);
      throw new I18nHttpException('payment.refund_failed', 'PAYMENT_REFUND_FAILED', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Update PlatformWallet and create transaction
    const transaction = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          walletId: null, // PLATEFORME
          type: TransactionType.CAMPAIGN_REFUND,
          amount: new Decimal(refundAmount),
          reason: `Campaign end refund: ${campaign.title}`,
          campaignId,
          stripeRefundId: refund.id,
          status: TransactionStatus.COMPLETED,
          metadata: {
            unusedSlots,
            unusedSlotsRefund,
            totalPriceDifference,
            priceDifferences,
            perSlot: escrow.perTester,
            refundMethod: 'card',
          },
        },
      });

      // Update PlatformWallet
      const platformWallet = await tx.platformWallet.findFirst();
      if (!platformWallet) {
        throw new I18nHttpException('payment.platform_wallet_not_found', 'PAYMENT_PLATFORM_WALLET_NOT_FOUND', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      await tx.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: {
            decrement: new Decimal(refundAmount),
          },
        },
      });

      return transaction;
    });

    // Audit log
    await this.auditService.log(
      campaign.sellerId,
      AuditCategory.WALLET,
      'CAMPAIGN_REFUND_PROCESSED',
      {
        campaignId,
        unusedSlots,
        unusedSlotsRefund,
        totalPriceDifference,
        refundAmount,
        transactionId: transaction.id,
        stripeRefundId: refund.id,
      },
    );

    // Notification
    const refundDetails: string[] = [];
    if (unusedSlotsRefund > 0) {
      refundDetails.push(`${unusedSlotsRefund}€ pour ${unusedSlots} slot(s) non utilisé(s)`);
    }
    if (totalPriceDifference > 0) {
      refundDetails.push(`${totalPriceDifference}€ de différence de prix (prix max - prix réel)`);
    }

    this.notificationsService.tryQueueEmail({
      to: sellerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Remboursement de fin de campagne',
      variables: {
        firstName: sellerProfile!.firstName || 'Pro',
        campaignTitle: campaign.title,
        refundAmount,
        message: `Votre remboursement de ${refundAmount}€ pour la campagne "${campaign.title}" a été traité. Détail : ${refundDetails.join(' + ')}. Le montant sera crédité sur votre carte sous 5 à 10 jours ouvrés.`,
      },
      metadata: {
        campaignId,
        transactionId: transaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    this.logger.log(`Campaign end refund processed for ${campaignId}`);

    return {
      unusedSlots,
      totalPriceDifference,
      refundAmount,
      refund,
      transaction,
    };
  }

  // ============================================================================
  // Cancellation Refunds
  // ============================================================================

  /**
   * Traite le remboursement d'une campagne annulée par un PRO
   */
  async processCampaignCancellationRefund(
    campaignId: string,
    cancellationContext: {
      hoursElapsed: number;
      totalCompensation: number;
      totalCommission: number;
      compensationMap: Record<string, number>;
      totalDisbursed?: number;
      refundAmountOverride?: number;
    },
  ): Promise<{
    refundToPro: number;
    cancellationFee: number;
    refund: Stripe.Refund | null;
    compensationTransactions: Transaction[];
  }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        seller: true,
      },
    });

    if (!campaign) {
      throw new I18nHttpException('payment.campaign_not_found', 'PAYMENT_CAMPAIGN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (!campaign.stripePaymentIntentId) {
      throw new I18nHttpException('payment.no_payment_found', 'PAYMENT_NO_PAYMENT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Récupérer le PlatformWallet (nécessaire pour les updates d'escrow balance)
    const platformWallet = await this.prisma.platformWallet.findFirst();
    if (!platformWallet) {
      throw new I18nHttpException('payment.no_platform_wallet', 'PAYMENT_NO_PLATFORM_WALLET', HttpStatus.NOT_FOUND);
    }

    const totalEscrowAmount = Number(campaign.escrowAmount || 0);
    const totalDisbursed = cancellationContext.totalDisbursed || 0;

    // Calculer les montants via BusinessRules (fee sur le restant après compensations + commission + déjà versé)
    const calculated =
      await this.businessRulesService.calculateProCancellationImpact(
        totalEscrowAmount,
        cancellationContext.hoursElapsed,
        cancellationContext.totalCompensation,
        cancellationContext.totalCommission,
        totalDisbursed,
      );

    // Si override fourni (grace period + capturé + 0 testeurs → rembourser totalPaid)
    const refundToPro = cancellationContext.refundAmountOverride ?? calculated.refundToPro;
    const { cancellationFee, supertryCommission } = calculated;

    this.logger.log(
      `Processing PRO cancellation refund for campaign ${campaignId}: refund=${refundToPro}€, fee=${cancellationFee}€, commission=${supertryCommission}€, totalCompensation=${cancellationContext.totalCompensation}€, totalDisbursed=${totalDisbursed}€`,
    );

    let refund: Stripe.Refund | null = null;
    const compensationTransactions: Transaction[] = [];

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1 : Appels Stripe (non-transactionnels, collecte des résultats)
    // ══════════════════════════════════════════════════════════════════════

    // 1. Rembourser le PRO (si montant > 0)
    if (refundToPro > 0) {
      if (!campaign.paymentCapturedAt) {
        await this.stripeService.cancelPaymentIntent(
          campaign.stripePaymentIntentId,
          'requested_by_customer',
        );
      } else {
        refund = await this.stripeService.createRefund(
          campaign.stripePaymentIntentId,
          refundToPro,
          'requested_by_customer',
          {
            campaignId,
            transactionType: 'PRO_CANCELLATION_REFUND',
            sellerId: campaign.sellerId,
          },
          `cancel_${campaignId}`,
        );
      }
    }

    // 2. Transférer compensations aux testeurs via Stripe
    const testerTransfers: { testerId: string; amount: number; transferId: string; profile: any }[] = [];
    const testerIds = Object.keys(cancellationContext.compensationMap);

    for (const testerId of testerIds) {
      const testerCompensation = cancellationContext.compensationMap[testerId];
      if (testerCompensation <= 0) continue;

      const testerProfile = await this.prisma.profile.findUnique({
        where: { id: testerId },
      });

      if (!testerProfile || !testerProfile.stripeConnectAccountId) {
        this.logger.warn(`Skipping compensation for tester ${testerId} - no Stripe account`);
        continue;
      }

      const transfer = await this.stripeService.createTransfer(
        testerCompensation,
        testerProfile.stripeConnectAccountId,
        'eur',
        {
          campaignId,
          testerId,
          transactionType: 'PRO_CANCELLATION_COMPENSATION',
        },
        undefined,
        `campaign_${campaignId}`,
        `Compensation: ${campaign.title} - annulation PRO`,
      );

      testerTransfers.push({
        testerId,
        amount: testerCompensation,
        transferId: transfer.id,
        profile: testerProfile,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 2 : Toutes les écritures DB dans une seule $transaction
    // ══════════════════════════════════════════════════════════════════════

    const dbResult = await this.prisma.$transaction(async (tx) => {
      const txCompensations: Transaction[] = [];

      // Calcul cumulatif du décrement d'escrow
      let escrowDecrement = 0;
      let commissionIncrement = 0;
      let totalCommissionsIncrement = 0;

      // 1. Transaction de remboursement PRO
      if (refundToPro > 0) {
        const sellerWallet = await tx.wallet.findUnique({
          where: { userId: campaign.sellerId },
        });

        await tx.transaction.create({
          data: {
            walletId: sellerWallet?.id || null,
            campaignId,
            type: TransactionType.CAMPAIGN_REFUND,
            amount: new Decimal(refundToPro),
            reason: `Refund for cancelled campaign: ${campaign.title}`,
            status: TransactionStatus.COMPLETED,
            stripeRefundId: refund?.id ?? null,
          },
        });

        escrowDecrement += refundToPro;
      }

      // 2. Commission SuperTry
      if (supertryCommission > 0) {
        await tx.transaction.create({
          data: {
            walletId: null,
            campaignId,
            type: TransactionType.COMMISSION,
            amount: new Decimal(supertryCommission),
            reason: `Commission retained on PRO cancellation: ${campaign.title}`,
            status: TransactionStatus.COMPLETED,
          },
        });

        escrowDecrement += supertryCommission;
        commissionIncrement += supertryCommission;
        totalCommissionsIncrement += supertryCommission;
      }

      // 3. Frais d'annulation
      if (cancellationFee > 0) {
        await tx.transaction.create({
          data: {
            walletId: null,
            campaignId,
            type: TransactionType.CANCELLATION_COMMISSION,
            amount: new Decimal(cancellationFee),
            reason: `Cancellation fee (${cancellationFee}€) for campaign: ${campaign.title}`,
            status: TransactionStatus.COMPLETED,
          },
        });

        escrowDecrement += cancellationFee;
      }

      // 4. Compensations testeurs (DB uniquement, Stripe déjà fait)
      for (const t of testerTransfers) {
        const testerWallet = await tx.wallet.findUnique({
          where: { userId: t.testerId },
        });

        const compensationTx = await tx.transaction.create({
          data: {
            walletId: testerWallet?.id || null,
            campaignId,
            type: TransactionType.TESTER_COMPENSATION,
            amount: new Decimal(t.amount),
            reason: `Compensation for PRO cancellation: ${campaign.title}`,
            status: TransactionStatus.COMPLETED,
            stripeTransferId: t.transferId,
          },
        });

        txCompensations.push(compensationTx);

        if (testerWallet) {
          await tx.wallet.update({
            where: { id: testerWallet.id },
            data: {
              balance: { increment: new Decimal(t.amount) },
              totalEarned: { increment: new Decimal(t.amount) },
            },
          });
        }

        escrowDecrement += t.amount;
      }

      // 5. Mise à jour unique du PlatformWallet
      if (escrowDecrement > 0 || commissionIncrement > 0) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { decrement: new Decimal(escrowDecrement) },
            ...(commissionIncrement > 0 && {
              commissionBalance: { increment: new Decimal(commissionIncrement) },
            }),
            ...(totalCommissionsIncrement > 0 && {
              totalCommissions: { increment: new Decimal(totalCommissionsIncrement) },
            }),
          },
        });
      }

      return { txCompensations };
    });

    compensationTransactions.push(...dbResult.txCompensations);

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 3 : Notifications (non-critiques, hors transaction)
    // ══════════════════════════════════════════════════════════════════════

    for (const t of testerTransfers) {
      const compensationTx = compensationTransactions.find(
        (tx) => tx.stripeTransferId === t.transferId,
      );

      this.notificationsService.tryQueueEmail({
        to: t.profile.email,
        template: NotificationTemplate.GENERIC_NOTIFICATION,
        subject: 'Compensation pour annulation de campagne',
        variables: {
          firstName: t.profile.firstName || 'Testeur',
          campaignTitle: campaign.title,
          compensationAmount: t.amount,
          message: `Le professionnel a annulé la campagne "${campaign.title}". Vous avez reçu une compensation de ${t.amount}€ pour ce désagrément.`,
        },
        metadata: {
          campaignId,
          transactionId: compensationTx?.id,
          type: NotificationType.PAYMENT_RECEIVED,
        },
      });
    }

    this.notificationsService.tryQueueEmail({
      to: campaign.seller.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Campagne annulée - Remboursement traité',
      variables: {
        firstName: campaign.seller.firstName || 'Pro',
        campaignTitle: campaign.title,
        refundAmount: refundToPro,
        cancellationFee,
        message: `Votre campagne "${campaign.title}" a été annulée. ${refundToPro > 0 ? `Vous serez remboursé de ${refundToPro}€.` : ''} ${cancellationFee > 0 ? `Frais d'annulation: ${cancellationFee}€.` : ''}`,
      },
      metadata: {
        campaignId,
        type: NotificationType.SESSION_CANCELLED,
      },
    });

    // Audit
    await this.auditService.log(
      campaign.sellerId,
      AuditCategory.WALLET,
      'CAMPAIGN_CANCELLATION_REFUND',
      {
        campaignId,
        refundToPro,
        cancellationFee,
        supertryCommission,
        totalCompensation: cancellationContext.totalCompensation,
        compensationMap: cancellationContext.compensationMap,
      },
    );

    this.logger.log(`PRO cancellation refund processed for campaign ${campaignId}`);

    return {
      refundToPro,
      cancellationFee,
      refund,
      compensationTransactions,
    };
  }

  /**
   * Traite l'annulation d'une session par un testeur après PURCHASE_VALIDATED.
   * Le testeur garde le remboursement achat (déjà transféré).
   * SuperTry prélève une commission réduite (50%).
   */
  async processSessionCancellationRefund(
    sessionId: string,
  ): Promise<{
    supertryCommission: number;
  }> {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        tester: true,
        campaign: {
          include: {
            offers: true,
            seller: true,
          },
        },
      },
    });

    if (!session) {
      throw new I18nHttpException('session.not_found', 'SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Récupérer le PlatformWallet
    const platformWallet = await this.prisma.platformWallet.findFirst();
    if (!platformWallet) {
      throw new I18nHttpException('payment.no_platform_wallet', 'PAYMENT_NO_PLATFORM_WALLET', HttpStatus.NOT_FOUND);
    }

    // Commission réduite SuperTry (50% de la commission normale)
    const { supertryCommission } =
      await this.businessRulesService.calculateTesterCancellationImpact();

    this.logger.log(
      `Processing tester cancellation for session ${sessionId}: commission=${supertryCommission}€ (tester keeps purchase reimbursement)`,
    );

    // Enregistrer la commission réduite SuperTry
    await this.prisma.transaction.create({
      data: {
        walletId: null, // PLATEFORME
        campaignId: session.campaignId,
        sessionId,
        type: TransactionType.CANCELLATION_COMMISSION,
        amount: new Decimal(supertryCommission),
        reason: `Cancellation commission (50%) for session: ${session.campaign.title}`,
        status: TransactionStatus.COMPLETED,
      },
    });

    // Mettre à jour escrow balance pour la commission
    await this.prisma.platformWallet.update({
      where: { id: platformWallet.id },
      data: {
        escrowBalance: {
          decrement: new Decimal(supertryCommission),
        },
        commissionBalance: {
          increment: new Decimal(supertryCommission),
        },
        totalCommissions: {
          increment: new Decimal(supertryCommission),
        },
      },
    });

    // Notifier le testeur
    this.notificationsService.tryQueueEmail({
      to: session.tester.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Session annulée',
      variables: {
        firstName: session.tester.firstName || 'Testeur',
        campaignTitle: session.campaign.title,
        message: `Votre session pour la campagne "${session.campaign.title}" a été annulée. Le remboursement de votre achat vous a déjà été versé.`,
      },
      metadata: {
        sessionId,
        campaignId: session.campaignId,
        type: NotificationType.SESSION_CANCELLED,
      },
    });

    // Notifier le PRO
    this.notificationsService.tryQueueEmail({
      to: session.campaign.seller.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Un testeur a annulé sa session',
      variables: {
        firstName: session.campaign.seller.firstName || 'Pro',
        campaignTitle: session.campaign.title,
        testerName: session.tester.firstName || 'Le testeur',
        message: `Le testeur ${session.tester.firstName || 'Un testeur'} a annulé sa session pour la campagne "${session.campaign.title}". La place est maintenant disponible pour un autre testeur.`,
      },
      metadata: {
        sessionId,
        campaignId: session.campaignId,
        type: NotificationType.SESSION_CANCELLED,
      },
    });

    // Audit
    await this.auditService.log(
      session.testerId,
      AuditCategory.WALLET,
      'TESTER_CANCELLATION_COMMISSION',
      {
        sessionId,
        supertryCommission,
        campaignId: session.campaignId,
        purchaseReimbursementKept: Number(session.purchaseReimbursementAmount ?? 0),
      },
    );

    this.logger.log(`Tester cancellation processed for session ${sessionId}`);

    return {
      supertryCommission,
    };
  }

  /**
   * Compense un testeur suite à l'annulation d'une session par le PRO
   */
  async compensateTesterOnProCancellation(
    sessionId: string,
  ): Promise<{
    compensationAmount: number;
    transfer: Stripe.Transfer;
    transaction: Transaction;
  }> {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        tester: true,
        campaign: {
          include: {
            seller: true,
          },
        },
      },
    });

    if (!session) {
      throw new I18nHttpException('session.not_found', 'SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (!session.tester.stripeConnectAccountId) {
      throw new I18nHttpException('payment.tester_no_stripe', 'PAYMENT_TESTER_NO_STRIPE', HttpStatus.NOT_FOUND);
    }

    // Récupérer le PlatformWallet
    const platformWallet = await this.prisma.platformWallet.findFirst();
    if (!platformWallet) {
      throw new I18nHttpException('payment.no_platform_wallet', 'PAYMENT_NO_PLATFORM_WALLET', HttpStatus.NOT_FOUND);
    }

    // Récupérer le montant de compensation via BusinessRules
    const compensationAmount =
      await this.businessRulesService.getTesterCompensationOnProCancellation();

    this.logger.log(
      `Processing tester compensation for session ${sessionId}: ${compensationAmount}€`,
    );

    // Transférer la compensation au testeur
    const transfer = await this.stripeService.createTransfer(
      compensationAmount,
      session.tester.stripeConnectAccountId,
      'eur',
      {
        sessionId,
        campaignId: session.campaignId,
        transactionType: 'PRO_SESSION_CANCELLATION_COMPENSATION',
      },
      undefined, // sourceTransaction
      `campaign_${session.campaignId}`, // transferGroup
      `Compensation session: ${session.campaign.title} - annulation PRO`, // description
    );

    // Trouver le wallet du testeur
    const testerWallet = await this.prisma.wallet.findUnique({
      where: { userId: session.testerId },
    });

    // Créer transaction
    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: testerWallet?.id || null,
        campaignId: session.campaignId,
        sessionId,
        type: TransactionType.TESTER_COMPENSATION,
        amount: new Decimal(compensationAmount),
        reason: `Compensation for PRO session cancellation: ${session.campaign.title}`,
        status: TransactionStatus.COMPLETED,
        stripeTransferId: transfer.id,
      },
    });

    // Mettre à jour le wallet du testeur
    if (testerWallet) {
      await this.prisma.wallet.update({
        where: { id: testerWallet.id },
        data: {
          balance: { increment: new Decimal(compensationAmount) },
          totalEarned: { increment: new Decimal(compensationAmount) },
        },
      });
    }

    // Mettre à jour escrow balance
    await this.prisma.platformWallet.update({
      where: { id: platformWallet.id },
      data: {
        escrowBalance: {
          decrement: new Decimal(compensationAmount),
        },
      },
    });

    // Notifier le testeur
    this.notificationsService.tryQueueEmail({
      to: session.tester.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Compensation pour annulation de session',
      variables: {
        firstName: session.tester.firstName || 'Testeur',
        campaignTitle: session.campaign.title,
        compensationAmount,
        message: `Le professionnel a annulé votre session pour "${session.campaign.title}". Vous avez reçu une compensation de ${compensationAmount}€.`,
      },
      metadata: {
        sessionId,
        campaignId: session.campaignId,
        transactionId: transaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    // Audit
    await this.auditService.log(
      session.testerId,
      AuditCategory.WALLET,
      'TESTER_SESSION_COMPENSATION',
      {
        sessionId,
        compensationAmount,
        campaignId: session.campaignId,
      },
    );

    this.logger.log(`Tester compensation processed for session ${sessionId}`);

    return {
      compensationAmount,
      transfer,
      transaction,
    };
  }

  // ============================================================================
  // Validation
  // ============================================================================

  async validateStripeConnectAccount(userId: string): Promise<boolean> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true, stripeOnboardingCompleted: true },
    });

    if (!profile?.stripeConnectAccountId) {
      throw new I18nHttpException('payment.no_stripe_connect', 'PAYMENT_NO_STRIPE_CONNECT', HttpStatus.NOT_FOUND);
    }

    if (!profile.stripeOnboardingCompleted) {
      throw new I18nHttpException('payment.onboarding_incomplete', 'PAYMENT_ONBOARDING_INCOMPLETE', HttpStatus.BAD_REQUEST);
    }

    // Check KYC status
    const kycStatus = await this.stripeService.getKycStatus(profile.stripeConnectAccountId);

    if (!kycStatus.chargesEnabled) {
      throw new I18nHttpException('payment.charges_not_enabled', 'PAYMENT_CHARGES_NOT_ENABLED', HttpStatus.BAD_REQUEST);
    }

    return true;
  }
}
