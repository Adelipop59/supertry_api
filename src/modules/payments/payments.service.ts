import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from '../wallet/wallet.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
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
      throw new NotFoundException('Campaign or offer not found');
    }

    // Si userId fourni, vérifier ownership (PRO owner ou ADMIN)
    if (userId) {
      const user = await this.prisma.profile.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });

      if (user?.role !== 'ADMIN' && campaign.sellerId !== userId) {
        throw new ForbiddenException('Not authorized to view this campaign price summary');
      }
    }

    const rules = await this.businessRulesService.findLatest();

    const offer = campaign.offers[0];
    const productCost = Number(offer.maxReimbursedPrice ?? offer.expectedPrice);
    const shippingCost = Number(offer.maxReimbursedShipping ?? offer.shippingCost);
    const testerBonus = rules.testerBonus;
    const supertryCommission = rules.supertryCommission;
    const proBonus = Number(offer.bonus ?? 0);

    // baseCost = maxPrice + maxShipping + commission plateforme + bonus PRO (SANS couverture Stripe)
    const platformCommission = testerBonus + supertryCommission;
    const baseCostWithoutCommission = productCost + shippingCost + platformCommission + proBonus;

    // Calcul via BusinessRules: commission fixe + 3.5% couverture Stripe
    const { commissionFixedFee, stripeCoverage, totalPerTester } =
      await this.businessRulesService.calculateCommission(baseCostWithoutCommission);

    // Per tester WITHOUT Stripe fees
    const perTesterWithoutStripeFees = Math.round((baseCostWithoutCommission + commissionFixedFee) * 100) / 100;

    const totalSlots = campaign.totalSlots;

    return {
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      totalSlots,
      // Détail par ligne
      breakdown: {
        productCost,
        shippingCost,
        testerBonus,
        supertryCommission,
        commissionFixedFee,
        proBonus,
        stripeFees: stripeCoverage,
      },
      // Récap par testeur
      perTesterSummary: {
        withoutStripeFees: perTesterWithoutStripeFees,
        withStripeFees: totalPerTester,
      },
      // Récap total campagne
      totalSummary: {
        withoutStripeFees: Math.round(perTesterWithoutStripeFees * totalSlots * 100) / 100,
        withStripeFees: Math.round(totalPerTester * totalSlots * 100) / 100,
      },
      // Champs flat (utilisés en interne par processCampaignPayment, refundUnusedSlots, etc.)
      productCost,
      shippingCost,
      platformCommission,
      proBonus,
      supertryCommission: commissionFixedFee,
      stripeCoverage,
      perTester: totalPerTester,
      total: Math.round(totalPerTester * totalSlots * 100) / 100,
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
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.sellerId !== userId) {
      throw new ForbiddenException('Not authorized');
    }

    // Idempotency: block payment if campaign is not in DRAFT status
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException(
        `Campaign is already in status "${campaign.status}". Payment can only be processed for DRAFT campaigns.`,
      );
    }

    // Idempotency: block if a PaymentIntent already exists for this campaign
    if (campaign.stripePaymentIntentId) {
      throw new BadRequestException(
        'A payment has already been initiated for this campaign. Please contact support if you believe this is an error.',
      );
    }

    // Calculate escrow
    const escrow = await this.calculateCampaignEscrow(campaignId);

    this.logger.log(`Processing payment for campaign ${campaignId}: ${escrow.total}€`);

    // Create Stripe PaymentIntent
    const paymentIntent = await this.stripeService.createPaymentIntent(escrow.total, 'eur', {
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
      throw new BadRequestException('Payment confirmation failed');
    }

    // Separate Charges and Transfers: Argent va sur PlatformWallet
    const result = await this.prisma.$transaction(async (tx) => {
      // Transaction PLATEFORME (walletId: null)
      const transaction = await tx.transaction.create({
        data: {
          walletId: null, // PLATEFORME
          type: TransactionType.CAMPAIGN_PAYMENT,
          amount: new Decimal(escrow.total),
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
            increment: new Decimal(escrow.total),
          },
          totalReceived: {
            increment: new Decimal(escrow.total),
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
        amount: escrow.total,
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
    await this.notificationsService.queueEmail({
      to: sellerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Campaign Payment Confirmed',
      variables: {
        firstName: sellerProfile!.firstName,
        campaignTitle: campaign.title,
        amount: escrow.total,
        totalSlots: campaign.totalSlots,
        message: `Your payment of ${escrow.total}€ has been processed successfully. Your campaign is now active!`,
      },
      metadata: {
        campaignId,
        transactionId: result.transaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    this.logger.log(`Campaign payment processed successfully: ${campaignId}`);

    return {
      paymentIntent: confirmedPayment,
      transaction: result.transaction,
      campaign: result.campaign,
    };
  }

  // ============================================================================
  // Test Session Completion Payment
  // ============================================================================

  async processTestCompletion(sessionId: string): Promise<{
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

    // Get tester and seller profiles
    const [testerProfile, sellerProfile] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { id: session!.testerId },
        select: { id: true, email: true, firstName: true, stripeConnectAccountId: true },
      }),
      this.prisma.profile.findUnique({
        where: { id: session!.campaign.sellerId },
        select: { id: true, email: true, firstName: true, stripeConnectAccountId: true },
      }),
    ]);

    if (!session) {
      throw new NotFoundException('Test session not found');
    }

    // Get business rules
    const rules = await this.businessRulesService.findLatest();

    // Calculate reward for tester using REAL amounts paid by tester
    // NOT the expected/max amounts from the offer
    const productCost = Number(session.productPrice);  // Real price paid
    const shippingCost = Number(session.shippingCost); // Real shipping paid
    const testerBonus = rules.testerBonus;             // 5€ fixe (BusinessRules)
    const proBonus = Number(session.campaign.offers[0].bonus ?? 0); // Bonus supplémentaire PRO
    const rewardAmount = productCost + shippingCost + testerBonus + proBonus;
    const commissionAmount = rules.supertryCommission; // 5€ fixe (BusinessRules)

    // Vérifier TESTEUR Identity KYC (obligatoire)
    const testerStripeAccount = testerProfile?.stripeConnectAccountId;
    if (!testerStripeAccount) {
      throw new InternalServerErrorException('Tester has no Stripe Connect account');
    }

    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.logger.log(`💰 PROCESSING TEST COMPLETION FOR SESSION ${sessionId}`);
    this.logger.log(`   Product Cost: ${productCost}€`);
    this.logger.log(`   Shipping Cost: ${shippingCost}€`);
    this.logger.log(`   Tester Fee (fixed): ${testerBonus}€`);
    this.logger.log(`   Pro Bonus: ${proBonus}€`);
    this.logger.log(`   TOTAL REWARD: ${rewardAmount}€`);
    this.logger.log(`   Commission (SuperTry): ${commissionAmount}€`);
    this.logger.log(`   Tester Stripe Account: ${testerStripeAccount}`);
    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Create wallet for tester if doesn't exist
    await this.walletService.createWallet(session.testerId);

    // Vérifier stripeIdentityVerified pour TESTEUR (uniquement après N tests complétés)
    const testerIdentity = await this.prisma.profile.findUnique({
      where: { id: session.testerId },
      select: { stripeIdentityVerified: true, completedSessionsCount: true },
    });

    const kycThreshold = rules.kycRequiredAfterTests ?? 3;
    const completedCount = testerIdentity?.completedSessionsCount ?? 0;

    // IMPORTANT: Utiliser ">" (strictement supérieur) et non ">=" car completedSessionsCount
    // est déjà incrémenté pour le test en cours AVANT l'appel à processTestCompletion.
    // À la candidature (apply), le check utilise ">=" sur le compteur AVANT incrément.
    // Donc ici ">" sur le compteur APRÈS incrément = même filtre effectif.
    // Résultat: si le testeur a pu postuler, il sera forcément payé.
    if (completedCount > kycThreshold && !testerIdentity?.stripeIdentityVerified) {
      throw new BadRequestException({
        message: `Tester must complete Identity verification after ${kycThreshold} completed tests to continue receiving payments`,
        identityRequired: true,
      });
    }

    // NOTE: Pour les TESTEURS, on vérifie uniquement stripeIdentityVerified (après le seuil KYC)
    // Les TESTEURS REÇOIVENT de l'argent (transfers), ils n'en PRENNENT PAS (charges)
    // Donc chargesEnabled n'est PAS requis pour les testeurs

    // Create Platform Transfer: PLATEFORME → TESTEUR
    // Separate Charges and Transfers: argent vient du compte plateforme
    let testerTransfer: any = null;
    try {
      this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      this.logger.log(`🔄 CRÉATION TRANSFER PLATEFORME → TESTEUR`);
      this.logger.log(`   Session ID: ${sessionId}`);
      this.logger.log(`   Testeur Stripe Account: ${testerStripeAccount}`);
      this.logger.log(`   Montant: ${rewardAmount}€`);
      this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      // Récupérer le Charge ID pour source_transaction
      let sourceChargeId: string | undefined;
      if (session.campaign.stripePaymentIntentId) {
        sourceChargeId = await this.stripeService.getChargeIdFromPaymentIntent(
          session.campaign.stripePaymentIntentId,
        ) || undefined;
      }

      testerTransfer = await this.stripeService.createPlatformToConnectTransfer(
        rewardAmount,
        testerStripeAccount, // TO: TESTEUR's Connect account
        'eur',
        {
          platform: 'supertry',
          env: process.env.NODE_ENV || 'development',
          transactionType: 'TEST_REWARD',
          sessionId,
          campaignId: session.campaignId,
          campaignTitle: session.campaign.title,
          testerId: session.testerId,
          testerEmail: testerProfile?.email || 'N/A',
          testerName: testerProfile?.firstName || 'N/A',
          sellerId: session.campaign.sellerId,
          sellerEmail: sellerProfile?.email || 'N/A',
          productCost: productCost.toFixed(2),
          shippingCost: shippingCost.toFixed(2),
          testerFee: testerBonus.toFixed(2),
          proBonus: proBonus.toFixed(2),
          totalReward: rewardAmount.toFixed(2),
          commissionRetained: commissionAmount.toFixed(2),
          sourceChargeId: sourceChargeId || 'N/A',
          createdAt: new Date().toISOString(),
        },
        `Test reward: ${session.campaign.title} - ${testerProfile?.firstName || 'Tester'}`,
        `campaign_${session.campaignId}`,
      );
      this.logger.log(`✅ Transfer créé: ${testerTransfer.id} - ${rewardAmount}€ → ${testerStripeAccount}`);
    } catch (error) {
      this.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      this.logger.error(`❌ ÉCHEC DU TRANSFER PLATEFORME → TESTEUR`);
      this.logger.error(`   Session ID: ${sessionId}`);
      this.logger.error(`   Testeur: ${testerStripeAccount}`);
      this.logger.error(`   Montant: ${rewardAmount}€`);
      this.logger.error(`   Erreur: ${error.message}`);
      this.logger.error(`   Type: ${error.type || 'N/A'}`);
      this.logger.error(`   Code: ${error.code || 'N/A'}`);
      this.logger.error(`   Stack: ${error.stack}`);
      this.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      // Audit échec
      await this.auditService.log(
        null,
        AuditCategory.WALLET,
        'TRANSFER_FAILED',
        {
          sessionId,
          testerId: session.testerId,
          amount: rewardAmount,
          error: error.message,
          errorType: error.type,
          errorCode: error.code,
        },
      );

      throw new InternalServerErrorException(`Failed to transfer funds to tester: ${error.message}`);
    }

    // Create transactions in database
    const result = await this.prisma.$transaction(async (tx) => {
      // Get or create tester wallet
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

      // Transaction TEST_REWARD (testeur)
      const testerTransaction = await tx.transaction.create({
        data: {
          walletId: testerWallet.id,
          type: TransactionType.TEST_REWARD,
          amount: new Decimal(rewardAmount),
          reason: `Test reward: ${session.campaign.title}`,
          sessionId,
          campaignId: session.campaignId,
          stripeTransferId: testerTransfer?.id || null,
          status: TransactionStatus.COMPLETED,
          metadata: {
            productPrice: session.productPrice,
            shippingCost: session.shippingCost,
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
          balance: {
            increment: new Decimal(rewardAmount),
          },
          totalEarned: {
            increment: new Decimal(rewardAmount),
          },
          lastCreditedAt: new Date(),
        },
      });

      // Update PlatformWallet
      const platformWallet = await tx.platformWallet.findFirst();
      if (!platformWallet) {
        throw new InternalServerErrorException('PlatformWallet not found');
      }

      await tx.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: {
            decrement: new Decimal(rewardAmount + commissionAmount),
          },
          commissionBalance: {
            increment: new Decimal(commissionAmount),
          },
          totalTransferred: {
            increment: new Decimal(rewardAmount),
          },
          totalCommissions: {
            increment: new Decimal(commissionAmount),
          },
        },
      });

      return { testerTransaction, commissionTransaction };
    });

    // Audit logs
    await this.auditService.log(
      session.testerId,
      AuditCategory.WALLET,
      'TEST_COMPLETION_REWARD_CREDITED',
      {
        sessionId,
        campaignId: session.campaignId,
        rewardAmount,
        transactionId: result.testerTransaction.id,
        stripeTransferId: testerTransfer?.id || null,
      },
    );

    await this.auditService.log(
      null, // System action
      AuditCategory.WALLET,
      'COMMISSION_COLLECTED',
      {
        sessionId,
        campaignId: session.campaignId,
        commissionAmount,
        transactionId: result.commissionTransaction.id,
      },
    );

    // Notifications
    // 1. Notify tester
    await this.notificationsService.queueEmail({
      to: testerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Payment Received - Test Completed',
      variables: {
        firstName: testerProfile!.firstName || 'Tester',
        campaignTitle: session.campaign.title,
        amount: rewardAmount,
        message: `Congratulations! You've received ${rewardAmount}€ for completing the test.`,
      },
      metadata: {
        userId: session.testerId,
        sessionId,
        transactionId: result.testerTransaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    // 2. Notify seller
    await this.notificationsService.queueEmail({
      to: sellerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Test Session Completed',
      variables: {
        firstName: sellerProfile!.firstName || 'Seller',
        testerName: testerProfile!.firstName || 'Tester',
        campaignTitle: session.campaign.title,
        message: `A tester has completed your campaign "${session.campaign.title}".`,
      },
      metadata: {
        userId: session.campaign.sellerId,
        sessionId,
        campaignId: session.campaignId,
        type: NotificationType.TEST_VALIDATED,
      },
    });

    this.logger.log(`Test completion processed: ${sessionId}`);

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
    refundAmount: number;
    refund: Stripe.Refund;
    transaction: Transaction;
  }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (!campaign.stripePaymentIntentId) {
      throw new NotFoundException('No PaymentIntent found for this campaign');
    }

    // Get seller profile and completed sessions count
    const [sellerProfile, completedSessionsCount] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { id: campaign.sellerId },
        select: { id: true, email: true, firstName: true },
      }),
      this.prisma.testSession.count({
        where: { campaignId, status: 'COMPLETED' },
      }),
    ]);

    const completedSessions = completedSessionsCount;
    const unusedSlots = campaign.totalSlots - completedSessions;

    if (unusedSlots <= 0) {
      throw new BadRequestException('No unused slots to refund');
    }

    // Calculate refund amount
    const escrow = await this.calculateCampaignEscrow(campaignId);
    const refundAmount = escrow.perTester * unusedSlots;

    this.logger.log(`Refunding ${unusedSlots} unused slots for campaign ${campaignId}: ${refundAmount}€`);

    // Create Stripe Refund: direct vers la carte du PRO avec metadata riches
    let refund: Stripe.Refund;
    try {
      refund = await this.stripeService.createRefund(
        campaign.stripePaymentIntentId,
        refundAmount,
        'requested_by_customer',
        {
          transactionType: 'UNUSED_SLOTS_REFUND',
          campaignId,
          campaignTitle: campaign.title || 'N/A',
          sellerId: campaign.sellerId,
          sellerEmail: sellerProfile?.email || 'N/A',
          unusedSlots: String(unusedSlots),
          totalSlots: String(campaign.totalSlots),
          completedSlots: String(completedSessions),
          perSlotRefund: escrow.perTester.toFixed(2),
          totalRefund: refundAmount.toFixed(2),
          originalPaymentIntentId: campaign.stripePaymentIntentId,
          createdAt: new Date().toISOString(),
        },
      );
      this.logger.log(`Refund created: ${refund.id} - ${refundAmount}€ → PRO card`);
    } catch (error) {
      this.logger.error(`Refund failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Refund failed. Contact support.');
    }

    // Update PlatformWallet and create transaction
    const transaction = await this.prisma.$transaction(async (tx) => {
      // Transaction CAMPAIGN_REFUND
      const transaction = await tx.transaction.create({
        data: {
          walletId: null, // PLATEFORME
          type: TransactionType.CAMPAIGN_REFUND,
          amount: new Decimal(refundAmount),
          reason: `Refund ${unusedSlots} unused slots: ${campaign.title}`,
          campaignId,
          stripeRefundId: refund.id,
          status: TransactionStatus.COMPLETED,
          metadata: {
            unusedSlots,
            perSlot: escrow.perTester,
            refundMethod: 'card',
          },
        },
      });

      // Update PlatformWallet: décrémenter escrow car argent rendu au PRO
      const platformWallet = await tx.platformWallet.findFirst();
      if (!platformWallet) {
        throw new InternalServerErrorException('PlatformWallet not found');
      }

      await tx.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: {
            decrement: new Decimal(refundAmount),
          },
          // Note: on ne compte pas comme "transferred" car c'est un refund direct
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
        refundAmount,
        transactionId: transaction.id,
        stripeRefundId: refund.id,
      },
    );

    // Notification
    await this.notificationsService.queueEmail({
      to: sellerProfile!.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Campaign Refund Processed',
      variables: {
        firstName: sellerProfile!.firstName || 'Seller',
        campaignTitle: campaign.title,
        refundAmount,
        unusedSlots,
        message: `Your refund of ${refundAmount}€ for ${unusedSlots} unused slots has been processed. The amount will be returned to your card within 5-10 business days.`,
      },
      metadata: {
        campaignId,
        transactionId: transaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    this.logger.log(`Refund processed for campaign ${campaignId}`);

    return {
      unusedSlots,
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
      acceptedTestersCount: number;
      acceptedTesterIds: string[];
    },
  ): Promise<{
    refundToPro: number;
    cancellationFee: number;
    compensationPerTester: number;
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
      throw new NotFoundException('Campaign not found');
    }

    if (!campaign.stripePaymentIntentId) {
      throw new NotFoundException('No payment found for this campaign');
    }

    // Récupérer le PlatformWallet
    const platformWallet = await this.prisma.platformWallet.findFirst();
    if (!platformWallet) {
      throw new NotFoundException('No platform wallet found');
    }

    const totalEscrowAmount = Number(platformWallet.escrowBalance);
    const hasAcceptedTesters = cancellationContext.acceptedTestersCount > 0;

    // Calculer les montants via BusinessRules
    const { refundToPro, cancellationFee, compensationPerTester } =
      await this.businessRulesService.calculateProCancellationImpact(
        totalEscrowAmount,
        cancellationContext.hoursElapsed,
        hasAcceptedTesters,
      );

    this.logger.log(
      `Processing PRO cancellation refund for campaign ${campaignId}: refund=${refundToPro}€, fee=${cancellationFee}€, compensation=${compensationPerTester}€`,
    );

    let refund: Stripe.Refund | null = null;
    const compensationTransactions: Transaction[] = [];

    // 1. Rembourser le PRO (si montant > 0)
    if (refundToPro > 0) {
      refund = await this.stripeService.createRefund(
        campaign.stripePaymentIntentId,
        refundToPro,
        'requested_by_customer',
        {
          campaignId,
          transactionType: 'PRO_CANCELLATION_REFUND',
          sellerId: campaign.sellerId,
        },
      );

      // Trouver le wallet du seller
      const sellerWallet = await this.prisma.wallet.findUnique({
        where: { userId: campaign.sellerId },
      });

      // Créer transaction de remboursement
      await this.prisma.transaction.create({
        data: {
          walletId: sellerWallet?.id || null,
          campaignId,
          type: TransactionType.CAMPAIGN_REFUND,
          amount: new Decimal(refundToPro),
          reason: `Refund for cancelled campaign: ${campaign.title}`,
          status: TransactionStatus.COMPLETED,
          stripePaymentIntentId: campaign.stripePaymentIntentId,
          stripeRefundId: refund.id,
        },
      });

      // Mettre à jour escrow balance
      await this.prisma.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: {
            decrement: new Decimal(refundToPro),
          },
        },
      });
    }

    // 2. Si frais d'annulation, les transférer à SuperTry
    if (cancellationFee > 0) {
      await this.prisma.transaction.create({
        data: {
          walletId: null, // PLATEFORME
          campaignId,
          type: TransactionType.CANCELLATION_COMMISSION,
          amount: new Decimal(cancellationFee),
          reason: `Cancellation fee (${cancellationFee}€) for campaign: ${campaign.title}`,
          status: TransactionStatus.COMPLETED,
        },
      });

      // Mettre à jour escrow balance
      await this.prisma.platformWallet.update({
        where: { id: platformWallet.id },
        data: {
          escrowBalance: {
            decrement: new Decimal(cancellationFee),
          },
        },
      });
    }

    // 3. Compenser les testeurs acceptés
    if (compensationPerTester > 0 && cancellationContext.acceptedTesterIds.length > 0) {
      for (const testerId of cancellationContext.acceptedTesterIds) {
        const testerProfile = await this.prisma.profile.findUnique({
          where: { id: testerId },
        });

        if (!testerProfile || !testerProfile.stripeConnectAccountId) {
          this.logger.warn(`Skipping compensation for tester ${testerId} - no Stripe account`);
          continue;
        }

        // Transférer la compensation au testeur
        const transfer = await this.stripeService.createTransfer(
          compensationPerTester,
          testerProfile.stripeConnectAccountId,
          'eur',
          {
            campaignId,
            testerId,
            transactionType: 'PRO_CANCELLATION_COMPENSATION',
          },
          undefined, // sourceTransaction
          `campaign_${campaignId}`, // transferGroup
          `Compensation: ${campaign.title} - annulation PRO`, // description
        );

        // Trouver le wallet du testeur
        const testerWallet = await this.prisma.wallet.findUnique({
          where: { userId: testerId },
        });

        // Créer transaction
        const compensationTx = await this.prisma.transaction.create({
          data: {
            walletId: testerWallet?.id || null,
            campaignId,
            type: TransactionType.TESTER_COMPENSATION,
            amount: new Decimal(compensationPerTester),
            reason: `Compensation for PRO cancellation: ${campaign.title}`,
            status: TransactionStatus.COMPLETED,
            stripeTransferId: transfer.id,
          },
        });

        compensationTransactions.push(compensationTx);

        // Mettre à jour escrow balance
        await this.prisma.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: {
              decrement: new Decimal(compensationPerTester),
            },
          },
        });

        // Notifier le testeur
        await this.notificationsService.queueEmail({
          to: testerProfile.email,
          template: NotificationTemplate.GENERIC_NOTIFICATION,
          subject: 'Compensation pour annulation de campagne',
          variables: {
            firstName: testerProfile.firstName || 'Testeur',
            campaignTitle: campaign.title,
            compensationAmount: compensationPerTester,
            message: `Le professionnel a annulé la campagne "${campaign.title}". Vous avez reçu une compensation de ${compensationPerTester}€ pour ce désagrément.`,
          },
          metadata: {
            campaignId,
            transactionId: compensationTx.id,
            type: NotificationType.PAYMENT_RECEIVED,
          },
        });
      }
    }

    // 4. Notifier le PRO
    await this.notificationsService.queueEmail({
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
        compensationPerTester,
        acceptedTestersCount: cancellationContext.acceptedTestersCount,
      },
    );

    this.logger.log(`PRO cancellation refund processed for campaign ${campaignId}`);

    return {
      refundToPro,
      cancellationFee,
      compensationPerTester,
      refund,
      compensationTransactions,
    };
  }

  /**
   * Traite le remboursement d'une session annulée par un testeur après PURCHASE_VALIDATED
   */
  async processSessionCancellationRefund(
    sessionId: string,
  ): Promise<{
    refundToTester: number;
    supertryCommission: number;
    refund: Stripe.Refund;
    transaction: Transaction;
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
      throw new NotFoundException('Session not found');
    }

    if (!session.campaign.stripePaymentIntentId) {
      throw new NotFoundException('No payment found for this campaign');
    }

    // Récupérer le PlatformWallet
    const platformWallet = await this.prisma.platformWallet.findFirst();
    if (!platformWallet) {
      throw new NotFoundException('No platform wallet found');
    }

    const rules = await this.businessRulesService.findLatest();
    const productCost = Number(session.validatedProductPrice || session.campaign.offers[0].expectedPrice);
    const shippingCost = Number(session.campaign.offers[0].shippingCost);
    const testerFee = rules.testerBonus;
    const proBonus = Number(session.campaign.offers[0].bonus ?? 0);
    const totalTesterBonus = testerFee + proBonus;

    // Calculer les montants via BusinessRules
    const { refundToTester, supertryCommission } =
      await this.businessRulesService.calculateTesterCancellationImpact(
        productCost,
        shippingCost,
        totalTesterBonus,
      );

    this.logger.log(
      `Processing tester cancellation refund for session ${sessionId}: refund=${refundToTester}€, commission=${supertryCommission}€`,
    );

    // 1. Rembourser le testeur
    const refund = await this.stripeService.createRefund(
      session.campaign.stripePaymentIntentId,
      refundToTester,
      'requested_by_customer',
      {
        sessionId,
        campaignId: session.campaignId,
        transactionType: 'TESTER_CANCELLATION_REFUND',
      },
    );

    // Trouver le wallet du testeur
    const testerWallet = await this.prisma.wallet.findUnique({
      where: { userId: session.testerId },
    });

    // Créer transaction de remboursement
    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: testerWallet?.id || null,
        campaignId: session.campaignId,
        sessionId,
        type: TransactionType.TESTER_CANCELLATION_REFUND,
        amount: new Decimal(refundToTester),
        reason: `Refund for cancelled session: ${session.campaign.title}`,
        status: TransactionStatus.COMPLETED,
        stripePaymentIntentId: session.campaign.stripePaymentIntentId,
        stripeRefundId: refund.id,
      },
    });

    // Mettre à jour escrow balance
    await this.prisma.platformWallet.update({
      where: { id: platformWallet.id },
      data: {
        escrowBalance: {
          decrement: new Decimal(refundToTester),
        },
      },
    });

    // 2. Enregistrer la commission réduite SuperTry
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
      },
    });

    // 3. Notifier le testeur
    await this.notificationsService.queueEmail({
      to: session.tester.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Session annulée - Remboursement traité',
      variables: {
        firstName: session.tester.firstName || 'Testeur',
        campaignTitle: session.campaign.title,
        refundAmount: refundToTester,
        message: `Votre session a été annulée. Vous serez remboursé de ${refundToTester}€ (produit + frais de port + bonus). Vous gardez le produit. Votre compte est temporairement suspendu pendant 14 jours.`,
      },
      metadata: {
        sessionId,
        campaignId: session.campaignId,
        transactionId: transaction.id,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    // 4. Notifier le PRO
    await this.notificationsService.queueEmail({
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
      'TESTER_CANCELLATION_REFUND',
      {
        sessionId,
        refundToTester,
        supertryCommission,
        campaignId: session.campaignId,
      },
    );

    this.logger.log(`Tester cancellation refund processed for session ${sessionId}`);

    return {
      refundToTester,
      supertryCommission,
      refund,
      transaction,
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
      throw new NotFoundException('Session not found');
    }

    if (!session.tester.stripeConnectAccountId) {
      throw new NotFoundException('Tester has no Stripe Connect account');
    }

    // Récupérer le PlatformWallet
    const platformWallet = await this.prisma.platformWallet.findFirst();
    if (!platformWallet) {
      throw new NotFoundException('No platform wallet found');
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
    await this.notificationsService.queueEmail({
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
      throw new NotFoundException('No Stripe Connect account found');
    }

    if (!profile.stripeOnboardingCompleted) {
      throw new BadRequestException('Complete Stripe onboarding first');
    }

    // Check KYC status
    const kycStatus = await this.stripeService.getKycStatus(profile.stripeConnectAccountId);

    if (!kycStatus.chargesEnabled) {
      throw new BadRequestException('Stripe account not enabled for charges');
    }

    return true;
  }
}
