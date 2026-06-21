import { Controller, Get, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { StripeService } from '../stripe/stripe.service';
import { InvoiceService } from './invoice.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAuthResponses, ApiNotFoundErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly stripeService: StripeService,
    private readonly invoiceService: InvoiceService,
  ) {}

  @ApiOperation({ summary: 'Récapitulatif du prix / escrow d\'une campagne' })
  @ApiResponse({ status: 200, description: 'Récapitulatif du prix retourné avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Get('campaigns/:id/escrow')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async calculateEscrow(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.paymentsService.calculateCampaignEscrow(campaignId, userId);
  }

  @ApiOperation({ summary: 'Créer une session de paiement' })
  @ApiResponse({ status: 200, description: 'Session de paiement créée avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Post('campaigns/:id/create-payment-intent')
  @Roles(UserRole.PRO)
  @HttpCode(HttpStatus.OK)
  async createPaymentIntent(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
  ) {
    const escrow = await this.paymentsService.calculateCampaignEscrow(campaignId);

    // Create Checkout Session instead of PaymentIntent for better UX
    const successUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/campaigns/${campaignId}/payment-success`;
    const cancelUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/campaigns/${campaignId}/payment-cancel`;

    const session = await this.stripeService.createCheckoutSession(
      escrow.totalAmount,
      'eur',
      { campaignId, userId },
      successUrl,
      cancelUrl,
    );

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      amount: escrow.totalAmount,
    };
  }

  // ⚠️ SUPPRIMÉ : l'endpoint POST /payments/campaigns/:id/pay (processCampaignPayment)
  // a été retiré. Il créait un PaymentIntent en capture AUTOMATIQUE (encaissement
  // immédiat), ce qui cassait le modèle escrow (capture différée + 1h d'annulation
  // gratuite), faisait échouer l'annulation et désynchronisait le scheduler.
  // Le seul flux de paiement campagne est désormais POST /campaigns/:id/checkout-session
  // (capture MANUELLE), activé après la période de grâce par le scheduler de capture.

  @ApiOperation({ summary: '[Admin] Retry les paiements d\'une session (reimbursement + bonus)' })
  @ApiResponse({ status: 200, description: 'Paiement retenté avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Post('admin/retry-session-payment/:sessionId')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async retrySessionPayment(@Param('sessionId') sessionId: string) {
    // Retry purchase reimbursement (idempotent — skips if already done)
    const reimbursement = await this.paymentsService.processPurchaseReimbursement(sessionId);
    // Retry bonus payment + commission (idempotent — skips if already done)
    const bonus = await this.paymentsService.processBonusPayment(sessionId);
    return {
      message: 'Payment retry successful',
      sessionId,
      reimbursement: reimbursement ? {
        transferId: reimbursement.testerTransfer?.id,
        transactionId: reimbursement.testerTransaction?.id,
      } : 'already processed',
      bonus: bonus ? {
        transferId: bonus.testerTransfer?.id,
        transactionId: bonus.testerTransaction?.id,
        commissionTransactionId: bonus.commissionTransaction?.id,
      } : 'already processed',
    };
  }

  @ApiOperation({ summary: 'Rembourser les slots non utilisés' })
  @ApiResponse({ status: 200, description: 'Remboursement effectué avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Post('campaigns/:id/refund')
  @Roles(UserRole.PRO)
  @HttpCode(HttpStatus.OK)
  async refundUnusedSlots(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.paymentsService.refundUnusedSlots(campaignId);

    return {
      message: 'Refund processed successfully',
      unusedSlots: result.unusedSlots,
      refundAmount: result.refundAmount,
      refundId: result.refund.id,
      transactionId: result.transaction.id,
    };
  }

  @ApiOperation({ summary: 'Récupérer la facture Stripe d\'une campagne payée' })
  @ApiResponse({ status: 200, description: 'URL de la facture retournée avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Get('campaigns/:id/invoice')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async getInvoice(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoiceService.getOrCreateInvoice(campaignId, userId);
  }
}
