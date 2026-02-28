import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { PaymentsService } from './payments.service';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Récupère ou crée la facture Stripe pour une campagne payée
   * - Si la facture existe déjà (stripeInvoiceUrl), retourne l'URL directement
   * - Sinon, crée le Customer Stripe + Invoice avec line items
   */
  async getOrCreateInvoice(
    campaignId: string,
    userId: string,
  ): Promise<{ url: string; invoiceNumber: string }> {
    // 1. Fetch campagne avec seller
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { seller: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // 2. Vérifier ownership
    if (campaign.sellerId !== userId) {
      throw new ForbiddenException('You are not the owner of this campaign');
    }

    // 3. Vérifier que la campagne a été payée
    if (!campaign.paymentAuthorizedAt) {
      throw new BadRequestException('Campaign has not been paid yet');
    }

    // 4. Si la facture existe déjà, retourner l'URL cached
    if (campaign.stripeInvoiceUrl && campaign.stripeInvoiceId) {
      this.logger.log(`Returning cached invoice for campaign ${campaignId}`);
      return {
        url: campaign.stripeInvoiceUrl,
        invoiceNumber: campaign.stripeInvoiceId,
      };
    }

    // 5. Créer ou récupérer le Stripe Customer
    const customerId = await this.stripeService.getOrCreateCustomer({
      id: campaign.seller.id,
      email: campaign.seller.email,
      firstName: campaign.seller.firstName,
      lastName: campaign.seller.lastName,
      companyName: campaign.seller.companyName,
      stripeCustomerId: campaign.seller.stripeCustomerId,
    });

    // 6. Calculer le breakdown escrow
    const escrow = await this.paymentsService.calculateCampaignEscrow(campaignId);

    // 7. Créer la facture Stripe
    const invoice = await this.stripeService.createInvoiceForCampaign(
      customerId,
      {
        breakdown: escrow.breakdown,
        totalSlots: escrow.totalSlots,
        campaignTitle: escrow.campaignTitle,
      },
      campaignId,
    );

    // 8. Sauvegarder sur la campagne
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        stripeInvoiceId: invoice.invoiceId,
        stripeInvoiceUrl: invoice.invoiceUrl,
      },
    });

    this.logger.log(`Invoice created for campaign ${campaignId}: ${invoice.invoiceId}`);

    return {
      url: invoice.invoiceUrl,
      invoiceNumber: invoice.invoiceId,
    };
  }
}
