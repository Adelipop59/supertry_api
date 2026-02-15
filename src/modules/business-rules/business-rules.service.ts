import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { UGCType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateBusinessRulesDto } from './dto/create-business-rules.dto';
import { UpdateBusinessRulesDto } from './dto/update-business-rules.dto';
import { BusinessRulesResponseDto } from './dto/business-rules-response.dto';

@Injectable()
export class BusinessRulesService {
  constructor(private prisma: PrismaService) {}

  private toResponseDto(rules: any): BusinessRulesResponseDto {
    return {
      ...rules,
      testerBonus: Number(rules.testerBonus),
      supertryCommission: Number(rules.supertryCommission),
      ugcVideoPrice: Number(rules.ugcVideoPrice),
      ugcVideoCommission: Number(rules.ugcVideoCommission),
      ugcPhotoPrice: Number(rules.ugcPhotoPrice),
      ugcPhotoCommission: Number(rules.ugcPhotoCommission),
      tipCommissionPercent: Number(rules.tipCommissionPercent),
      campaignActivationGracePeriodMinutes: rules.campaignActivationGracePeriodMinutes,
      campaignCancellationFeePercent: Number(rules.campaignCancellationFeePercent),
      testerCancellationBanDays: rules.testerCancellationBanDays,
      testerCancellationCommissionPercent: Number(rules.testerCancellationCommissionPercent),
      testerCompensationOnProCancellation: Number(rules.testerCompensationOnProCancellation),
      commissionFixedFee: Number(rules.commissionFixedFee),
      stripeFeePercent: Number(rules.stripeFeePercent),
      captureDelayMinutes: rules.captureDelayMinutes,
      maxUgcRejections: rules.maxUgcRejections,
      ugcDefaultDeadlineDays: rules.ugcDefaultDeadlineDays,
      kycRequiredAfterTests: rules.kycRequiredAfterTests,
    };
  }

  /**
   * Calcule la commission SuperTry (5€ fixe) + couverture frais Stripe (3.5%)
   * baseCost = productCost + shippingCost + testerBonus (SANS la commission)
   * Retourne le détail par testeur
   */
  async calculateCommission(baseCostWithoutCommission: number): Promise<{
    commissionFixedFee: number;
    stripeCoverage: number;
    totalPerTester: number;
  }> {
    const rules = await this.findLatest();
    const commissionFixedFee = rules.commissionFixedFee;
    const stripeFeePercent = rules.stripeFeePercent;

    // baseCost + commission fixe SuperTry
    const baseWithCommission = baseCostWithoutCommission + commissionFixedFee;

    // Couverture Stripe: on divise par (1 - fee%) pour que le % couvre aussi lui-même
    const stripeCoverage =
      (baseWithCommission * stripeFeePercent) / (1 - stripeFeePercent);

    const totalPerTester =
      Math.round((baseWithCommission + stripeCoverage) * 100) / 100;

    return {
      commissionFixedFee,
      stripeCoverage: Math.round(stripeCoverage * 100) / 100,
      totalPerTester,
    };
  }

  async create(
    createDto: CreateBusinessRulesDto,
  ): Promise<BusinessRulesResponseDto> {
    const rules = await this.prisma.businessRules.create({
      data: createDto,
    });

    return this.toResponseDto(rules);
  }

  async findAll(): Promise<BusinessRulesResponseDto[]> {
    const rules = await this.prisma.businessRules.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return rules.map((r) => this.toResponseDto(r));
  }

  async findLatest(): Promise<BusinessRulesResponseDto> {
    const rules = await this.prisma.businessRules.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!rules) {
      throw new NotFoundException('No business rules found');
    }

    return this.toResponseDto(rules);
  }

  async findOne(id: string): Promise<BusinessRulesResponseDto> {
    const rules = await this.prisma.businessRules.findUnique({
      where: { id },
    });

    if (!rules) {
      throw new NotFoundException(`Business rules with ID '${id}' not found`);
    }

    return this.toResponseDto(rules);
  }

  async update(
    id: string,
    updateDto: UpdateBusinessRulesDto,
  ): Promise<BusinessRulesResponseDto> {
    await this.findOne(id);

    const rules = await this.prisma.businessRules.update({
      where: { id },
      data: updateDto,
    });

    return this.toResponseDto(rules);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.prisma.businessRules.delete({
      where: { id },
    });
  }

  /**
   * Récupère la période de grâce pour l'activation d'une campagne (en minutes)
   */
  async getCampaignActivationGracePeriodMinutes(): Promise<number> {
    const rules = await this.findLatest();
    return rules.campaignActivationGracePeriodMinutes;
  }

  /**
   * Récupère le pourcentage de frais d'annulation pour une campagne PRO
   */
  async getCampaignCancellationFeePercent(): Promise<number> {
    const rules = await this.findLatest();
    return Number(rules.campaignCancellationFeePercent);
  }

  /**
   * Récupère le nombre de jours de ban pour un testeur qui annule
   */
  async getTesterCancellationBanDays(): Promise<number> {
    const rules = await this.findLatest();
    return rules.testerCancellationBanDays;
  }

  /**
   * Récupère le pourcentage de commission pour SuperTry sur une annulation testeur
   */
  async getTesterCancellationCommissionPercent(): Promise<number> {
    const rules = await this.findLatest();
    return Number(rules.testerCancellationCommissionPercent);
  }

  /**
   * Récupère le montant de compensation pour un testeur lors d'une annulation PRO
   */
  async getTesterCompensationOnProCancellation(): Promise<number> {
    const rules = await this.findLatest();
    return Number(rules.testerCompensationOnProCancellation);
  }

  /**
   * Calcule les impacts d'une annulation PRO selon le délai écoulé
   */
  async calculateProCancellationImpact(
    totalEscrowAmount: number,
    hoursElapsed: number,
    hasAcceptedTesters: boolean,
  ): Promise<{
    refundToPro: number;
    cancellationFee: number;
    compensationPerTester: number;
  }> {
    const rules = await this.findLatest();
    const gracePeriodHours = rules.campaignActivationGracePeriodMinutes / 60;

    // Annulation pendant la période de grâce
    if (hoursElapsed < gracePeriodHours) {
      return {
        refundToPro: totalEscrowAmount,
        cancellationFee: 0,
        compensationPerTester: 0,
      };
    }

    // Annulation après la période de grâce
    const cancellationFeePercent = Number(rules.campaignCancellationFeePercent);
    const cancellationFee = (totalEscrowAmount * cancellationFeePercent) / 100;

    // Si des testeurs ont accepté, ils reçoivent une compensation
    const compensationPerTester = hasAcceptedTesters
      ? Number(rules.testerCompensationOnProCancellation)
      : 0;

    return {
      refundToPro: totalEscrowAmount - cancellationFee,
      cancellationFee,
      compensationPerTester,
    };
  }

  /**
   * Retourne le prix et la commission UGC selon le type
   * VIDEO/PHOTO = payant, TEXT_REVIEW/EXTERNAL_REVIEW = gratuit
   */
  async getUgcPricing(type: UGCType): Promise<{ price: number; commission: number; isPaid: boolean }> {
    const rules = await this.findLatest();
    switch (type) {
      case 'VIDEO':
        return { price: rules.ugcVideoPrice, commission: rules.ugcVideoCommission, isPaid: true };
      case 'PHOTO':
        return { price: rules.ugcPhotoPrice, commission: rules.ugcPhotoCommission, isPaid: true };
      case 'TEXT_REVIEW':
      case 'EXTERNAL_REVIEW':
        return { price: 0, commission: 0, isPaid: false };
      default:
        throw new BadRequestException(`Unknown UGC type: ${type}`);
    }
  }

  async getMaxUgcRejections(): Promise<number> {
    const rules = await this.findLatest();
    return rules.maxUgcRejections;
  }

  async getUgcDefaultDeadlineDays(): Promise<number> {
    const rules = await this.findLatest();
    return rules.ugcDefaultDeadlineDays;
  }

  /**
   * Calcule les impacts d'une annulation testeur après PURCHASE_VALIDATED
   */
  async calculateTesterCancellationImpact(
    productCost: number,
    shippingCost: number,
    testerBonus: number,
  ): Promise<{
    refundToTester: number;
    supertryCommission: number;
    banDays: number;
  }> {
    const rules = await this.findLatest();
    const fullRefund = productCost + shippingCost + testerBonus;
    const normalCommission = Number(rules.supertryCommission);
    const cancellationCommissionPercent = Number(
      rules.testerCancellationCommissionPercent,
    );

    // SuperTry prend seulement 50% de la commission normale
    const supertryCommission = (normalCommission * cancellationCommissionPercent) / 100;

    return {
      refundToTester: fullRefund,
      supertryCommission,
      banDays: rules.testerCancellationBanDays,
    };
  }
}
