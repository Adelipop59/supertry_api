import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { CampaignResponseDto } from './dto/campaign-response.dto';
import { CampaignFilterDto } from './dto/campaign-filter.dto';
import { CheckEligibilityResponseDto } from './dto/check-eligibility-response.dto';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { Roles } from '../../common/decorators/roles.decorator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../stripe/stripe.service';
import { PrismaService } from '../../database/prisma.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly paymentsService: PaymentsService,
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateCampaignDto,
  ): Promise<CampaignResponseDto> {
    return this.campaignsService.create(userId, createDto);
  }

  @Get()
  async findAll(
    @Query() filterDto: CampaignFilterDto,
  ): Promise<PaginatedResponse<CampaignResponseDto>> {
    return this.campaignsService.findAll(filterDto);
  }

  @Get('my-campaigns')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async findMyCampaigns(
    @CurrentUser('id') userId: string,
    @Query() filterDto: CampaignFilterDto,
  ): Promise<PaginatedResponse<CampaignResponseDto>> {
    return this.campaignsService.findMyCampaigns(userId, filterDto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<CampaignResponseDto> {
    return this.campaignsService.findOne(id);
  }

  @Post(':id/check-eligibility')
  async checkEligibility(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
  ): Promise<CheckEligibilityResponseDto> {
    return this.campaignsService.checkEligibility(campaignId, userId);
  }

  @Patch(':id')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateCampaignDto,
  ): Promise<CampaignResponseDto> {
    return this.campaignsService.update(id, userId, updateDto);
  }

  @Delete(':id')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.campaignsService.remove(id, userId);
  }

  @Post(':id/checkout-session')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async createCheckoutSession(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    const escrow = await this.paymentsService.calculateCampaignEscrow(campaignId);

    // Récupérer infos seller + campagne pour metadata riches
    const [sellerProfile, campaign] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      }),
      this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { title: true, offers: { select: { productName: true } } },
      }),
    ]);

    // Metadata riches pour le Dashboard Stripe
    const stripeMetadata: Record<string, string> = {
      platform: 'supertry',
      env: process.env.NODE_ENV || 'development',
      transactionType: 'CAMPAIGN_PAYMENT',
      campaignId,
      campaignTitle: campaign?.title || 'N/A',
      sellerId: userId,
      sellerEmail: sellerProfile?.email || 'N/A',
      sellerName: `${sellerProfile?.firstName || ''} ${sellerProfile?.lastName || ''}`.trim() || 'N/A',
      totalSlots: String(escrow.totalSlots),
      productName: campaign?.offers?.[0]?.productName || 'N/A',
      productCost: escrow.productCost.toFixed(2),
      shippingCost: escrow.shippingCost.toFixed(2),
      testerBonus: escrow.testerBonus.toFixed(2),
      supertryCommission: escrow.supertryCommission.toFixed(2),
      stripeCoverage: escrow.stripeCoverage.toFixed(2),
      perTester: escrow.perTester.toFixed(2),
      totalAmount: escrow.total.toFixed(2),
      captureMethod: 'manual',
      createdAt: new Date().toISOString(),
    };

    // PRO n'a pas besoin de Stripe Connect - il paie simplement avec sa carte
    // L'argent va sur le compte PLATEFORME (Separate Charges and Transfers)
    // Manual capture: le PRO peut annuler dans 1h sans frais

    const session = await this.stripeService.createCheckoutSession(
      escrow.total,
      'eur',
      stripeMetadata,
      dto.successUrl,
      dto.cancelUrl,
      {
        captureMethod: 'manual',
        productName: `SuperTry - ${campaign?.title || 'Campaign'}`,
        productDescription: `Campaign: ${escrow.totalSlots} testeurs x ${escrow.perTester.toFixed(2)}€/testeur`,
      },
    );

    // Create transaction with stripeSessionId
    await this.prisma.transaction.create({
      data: {
        campaignId,
        type: 'CAMPAIGN_PAYMENT' as any,
        amount: escrow.total,
        reason: `Payment for campaign ${campaignId}`,
        status: 'PENDING' as any,
        stripeSessionId: session.id,
        metadata: {
          escrow,
          userId,
        },
      },
    });

    // Update campaign status to PENDING_PAYMENT
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PENDING_PAYMENT' as any },
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      amount: escrow.total * 100,
      currency: 'eur',
    };
  }

  @Post(':id/activate')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async activate(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<CampaignResponseDto> {
    return this.campaignsService.activate(id, userId);
  }
}
