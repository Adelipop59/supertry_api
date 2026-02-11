import { IsNotEmpty, IsNumber, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBusinessRulesDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  testerBonus: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supertryCommission: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcVideoPrice: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcVideoCommission: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcPhotoPrice: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcPhotoCommission: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  tipCommissionPercent: number;

  // Règles d'annulation PRO
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  campaignActivationGracePeriodMinutes: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  campaignCancellationFeePercent: number;

  // Règles d'annulation TESTEUR
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  testerCancellationBanDays: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  testerCancellationCommissionPercent: number;

  // Compensation testeur
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  testerCompensationOnProCancellation: number;

  // Commission hybride
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commissionFixedFee: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  stripeFeePercent: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  captureDelayMinutes: number;

  // KYC testeur : nombre de tests réussis avant obligation KYC Identity
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  kycRequiredAfterTests: number;
}
