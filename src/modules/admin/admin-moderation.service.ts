import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from '../wallet/wallet.service';
import { BusinessRulesService } from '../business-rules/business-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { MediaService, MediaFolder, MediaType } from '../media/media.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import {
  TransactionType,
  TransactionStatus,
  AuditCategory,
  NotificationType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CreditTesterMaxDto } from './dto/credit-tester-max.dto';
import { RequestDocumentsDto } from './dto/request-documents.dto';
import { AdminSessionFilterDto } from './dto/admin-session-filter.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AdminModerationService {
  private readonly logger = new Logger(AdminModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly walletService: WalletService,
    private readonly businessRulesService: BusinessRulesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly mediaService: MediaService,
  ) {}

  /**
   * Créditer le testeur du montant MAX (override admin)
   */
  async creditTesterMax(
    sessionId: string,
    adminId: string,
    dto: CreditTesterMaxDto,
  ) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: { include: { seller: true, offers: true } },
        tester: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const offer = session.campaign.offers[0];
    if (!offer) {
      throw new NotFoundException('No offer found for this campaign');
    }

    const testerStripeAccount = session.tester.stripeConnectAccountId;
    if (!testerStripeAccount) {
      throw new BadRequestException('Tester has no Stripe Connect account');
    }

    // Calculate MAX reward
    const rules = await this.businessRulesService.findLatest();
    const maxProductPrice = Number(offer.maxReimbursedPrice ?? offer.expectedPrice);
    const maxShippingCost = Number(offer.maxReimbursedShipping ?? offer.shippingCost);
    const testerBonus = rules.testerBonus;
    const proBonus = Number(offer.bonus ?? 0);
    const maxReward = maxProductPrice + maxShippingCost + testerBonus + proBonus;

    // Check if tester was already paid for this session
    const existingReward = await this.prisma.transaction.findFirst({
      where: {
        sessionId,
        type: TransactionType.TEST_REWARD,
        status: TransactionStatus.COMPLETED,
      },
    });

    const alreadyPaid = existingReward ? Number(existingReward.amount) : 0;
    const transferAmount = Math.round((maxReward - alreadyPaid) * 100) / 100;

    if (transferAmount <= 0) {
      throw new BadRequestException(
        `Tester already received ${alreadyPaid}€ which is >= max reward of ${maxReward}€`,
      );
    }

    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.logger.log(`🔧 ADMIN CREDIT TESTER MAX for session ${sessionId}`);
    this.logger.log(`   Max reward: ${maxReward}€`);
    this.logger.log(`   Already paid: ${alreadyPaid}€`);
    this.logger.log(`   Transfer amount: ${transferAmount}€`);
    this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Ensure tester wallet exists
    await this.walletService.createWallet(session.testerId);

    // Create Stripe transfer
    const transfer = await this.stripeService.createPlatformToConnectTransfer(
      transferAmount,
      testerStripeAccount,
      'eur',
      {
        platform: 'supertry',
        transactionType: 'ADMIN_CREDIT_MAX',
        sessionId,
        campaignId: session.campaignId,
        adminId,
        maxReward: maxReward.toFixed(2),
        alreadyPaid: alreadyPaid.toFixed(2),
        transferAmount: transferAmount.toFixed(2),
      },
      `Admin credit max: ${session.campaign.title}`,
      `campaign_${session.campaignId}`,
    );

    // DB updates
    const testerWallet = await this.prisma.wallet.findUnique({
      where: { userId: session.testerId },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          walletId: testerWallet?.id || null,
          campaignId: session.campaignId,
          sessionId,
          type: TransactionType.TEST_REWARD,
          amount: new Decimal(transferAmount),
          reason: dto.reason || `Admin credit max: ${session.campaign.title}`,
          status: TransactionStatus.COMPLETED,
          stripeTransferId: transfer.id,
          metadata: {
            adminOverride: true,
            adminId,
            maxReward,
            alreadyPaid,
            transferAmount,
          },
        },
      });

      if (testerWallet) {
        await tx.wallet.update({
          where: { id: testerWallet.id },
          data: {
            balance: { increment: new Decimal(transferAmount) },
            totalEarned: { increment: new Decimal(transferAmount) },
          },
        });
      }

      const platformWallet = await tx.platformWallet.findFirst();
      if (platformWallet) {
        await tx.platformWallet.update({
          where: { id: platformWallet.id },
          data: {
            escrowBalance: { decrement: new Decimal(transferAmount) },
            totalTransferred: { increment: new Decimal(transferAmount) },
          },
        });
      }
    });

    // Audit
    await this.auditService.log(
      adminId,
      AuditCategory.ADMIN,
      'ADMIN_CREDIT_TESTER_MAX',
      {
        sessionId,
        campaignId: session.campaignId,
        testerId: session.testerId,
        maxReward,
        alreadyPaid,
        transferAmount,
        reason: dto.reason,
      },
    );

    // Notify tester
    await this.notificationsService.queueEmail({
      to: session.tester.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Crédit supplémentaire reçu',
      variables: {
        firstName: session.tester.firstName || 'Testeur',
        campaignTitle: session.campaign.title,
        message: `Vous avez reçu un crédit supplémentaire de ${transferAmount}€ pour la campagne "${session.campaign.title}".`,
      },
      metadata: {
        sessionId,
        type: NotificationType.PAYMENT_RECEIVED,
      },
    });

    return {
      sessionId,
      maxReward,
      alreadyPaid,
      transferAmount,
      stripeTransferId: transfer.id,
    };
  }

  /**
   * Demander des documents au testeur ou PRO
   */
  async requestDocuments(
    sessionId: string,
    adminId: string,
    dto: RequestDocumentsDto,
  ) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: { include: { seller: true } },
        tester: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const targetProfile = dto.target === 'tester' ? session.tester : session.campaign.seller;

    // Build document request
    const request = {
      id: uuidv4(),
      documentTypes: dto.documentTypes,
      message: dto.message,
      target: dto.target,
      requestedAt: new Date().toISOString(),
      requestedBy: adminId,
      responseKeys: null,
      respondedAt: null,
    };

    // Append to existing requests
    const existingRequests = (session.adminDocumentRequests as any[]) || [];
    existingRequests.push(request);

    await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        adminDocumentRequests: existingRequests,
      },
    });

    // Notify target
    await this.notificationsService.queueEmail({
      to: targetProfile.email,
      template: NotificationTemplate.GENERIC_NOTIFICATION,
      subject: 'Documents demandés par l\'équipe SuperTry',
      variables: {
        firstName: targetProfile.firstName || 'Utilisateur',
        campaignTitle: session.campaign.title,
        message: `L'équipe SuperTry vous demande de fournir les documents suivants pour la campagne "${session.campaign.title}" : ${dto.documentTypes.join(', ')}. Message : ${dto.message}`,
      },
      metadata: {
        sessionId,
        type: NotificationType.SYSTEM_ALERT,
      },
    });

    // Audit
    await this.auditService.log(
      adminId,
      AuditCategory.ADMIN,
      'ADMIN_DOCUMENT_REQUEST',
      {
        sessionId,
        campaignId: session.campaignId,
        target: dto.target,
        documentTypes: dto.documentTypes,
        requestId: request.id,
      },
    );

    return { request, sessionId };
  }

  /**
   * Upload de documents en réponse à une demande admin (testeur ou PRO)
   */
  async uploadDisputeDocuments(
    sessionId: string,
    userId: string,
    files: Express.Multer.File[],
  ) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: { select: { sellerId: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Verify user is tester or PRO
    const isTester = session.testerId === userId;
    const isPro = session.campaign.sellerId === userId;
    if (!isTester && !isPro) {
      throw new BadRequestException('You are not involved in this session');
    }

    // Upload files to S3
    const uploadResults = await this.mediaService.uploadMultiple(
      files,
      MediaFolder.DISPUTES,
      MediaType.DOCUMENT,
      { subfolder: sessionId },
    );

    const newKeys = uploadResults.map((r) => r.key);

    // Append to existing dispute document keys
    const existingKeys = (session.disputeDocumentKeys as string[]) || [];
    const updatedKeys = [...existingKeys, ...newKeys];

    // Update adminDocumentRequests to mark response
    const requests = (session.adminDocumentRequests as any[]) || [];
    const target = isTester ? 'tester' : 'pro';
    const pendingRequest = requests.find(
      (r: any) => r.target === target && !r.respondedAt,
    );
    if (pendingRequest) {
      pendingRequest.responseKeys = newKeys;
      pendingRequest.respondedAt = new Date().toISOString();
    }

    await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        disputeDocumentKeys: updatedKeys,
        adminDocumentRequests: requests,
      },
    });

    // Audit
    await this.auditService.log(
      userId,
      AuditCategory.SESSION,
      'DISPUTE_DOCUMENTS_UPLOADED',
      {
        sessionId,
        uploadedBy: target,
        fileCount: files.length,
        keys: newKeys,
      },
    );

    return {
      sessionId,
      uploadedKeys: newKeys,
      totalDocuments: updatedKeys.length,
    };
  }

  /**
   * Lister les sessions avec filtres (admin)
   */
  async listSessions(filter: AdminSessionFilterDto) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.campaignId) {
      where.campaignId = filter.campaignId;
    }
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = new Date(filter.from);
      if (filter.to) where.createdAt.lte = new Date(filter.to);
    }

    const [sessions, total] = await Promise.all([
      this.prisma.testSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          campaign: {
            include: {
              seller: { select: { id: true, email: true, firstName: true, lastName: true } },
              offers: true,
            },
          },
          tester: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.testSession.count({ where }),
    ]);

    return {
      data: sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Résumé financier d'une session (admin)
   */
  async getSessionFinancialSummary(sessionId: string) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        campaign: { include: { offers: true, seller: { select: { id: true, email: true, firstName: true } } } },
        tester: { select: { id: true, email: true, firstName: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const offer = session.campaign.offers[0];
    const rules = await this.businessRulesService.findLatest();

    // Max amounts from offer
    const maxProductPrice = Number(offer?.maxReimbursedPrice ?? offer?.expectedPrice ?? 0);
    const maxShippingCost = Number(offer?.maxReimbursedShipping ?? offer?.shippingCost ?? 0);
    const testerBonus = rules.testerBonus;
    const proBonus = Number(offer?.bonus ?? 0);

    // Actual amounts from session
    const actualProductPrice = Number(session.productPrice ?? 0);
    const actualShippingCost = Number(session.shippingCost ?? 0);

    // Get all transactions for this session
    const transactions = await this.prisma.transaction.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    const testerRewardPaid = transactions
      .filter((t) => t.type === TransactionType.TEST_REWARD && t.status === TransactionStatus.COMPLETED)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const commissions = transactions
      .filter((t) => t.type === TransactionType.COMMISSION && t.status === TransactionStatus.COMPLETED)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const disputeResolutions = transactions
      .filter((t) => t.type === TransactionType.DISPUTE_RESOLUTION && t.status === TransactionStatus.COMPLETED)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const campaignRefunds = transactions
      .filter((t) => t.type === TransactionType.CAMPAIGN_REFUND && t.status === TransactionStatus.COMPLETED)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      session: {
        id: session.id,
        status: session.status,
        tester: session.tester,
        campaign: {
          id: session.campaign.id,
          title: session.campaign.title,
          seller: session.campaign.seller,
        },
      },
      maxAmounts: {
        productPrice: maxProductPrice,
        shippingCost: maxShippingCost,
        testerBonus,
        proBonus,
        total: maxProductPrice + maxShippingCost + testerBonus + proBonus,
      },
      actualAmounts: {
        productPrice: actualProductPrice,
        shippingCost: actualShippingCost,
        priceDifference: Math.max(0, maxProductPrice - actualProductPrice),
        shippingDifference: Math.max(0, maxShippingCost - actualShippingCost),
      },
      financials: {
        testerRewardPaid,
        commissions,
        disputeResolutions,
        campaignRefunds,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        reason: t.reason,
        status: t.status,
        createdAt: t.createdAt,
        metadata: t.metadata,
      })),
    };
  }
}
