import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { StripeService } from '../stripe/stripe.service';
import { ProcessCampaignPaymentDto } from './dto/process-campaign-payment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly stripeService: StripeService,
  ) {}

  @Get('campaigns/:id/escrow')
  @Roles(UserRole.PRO)
  async calculateEscrow(@Param('id') campaignId: string) {
    return this.paymentsService.calculateCampaignEscrow(campaignId);
  }

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
      escrow.total,
      'eur',
      { campaignId, userId },
      successUrl,
      cancelUrl,
    );

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      amount: escrow.total,
    };
  }

  @Post('campaigns/:id/pay')
  @Roles(UserRole.PRO)
  @HttpCode(HttpStatus.OK)
  async payCampaign(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
    @Body() paymentDto: ProcessCampaignPaymentDto,
  ) {
    const result = await this.paymentsService.processCampaignPayment(
      campaignId,
      userId,
      paymentDto.paymentMethodId,
    );

    return {
      message: 'Campaign payment processed successfully',
      paymentIntentId: result.paymentIntent.id,
      transactionId: result.transaction.id,
      campaignId: result.campaign.id,
      status: result.campaign.status,
    };
  }

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
}
