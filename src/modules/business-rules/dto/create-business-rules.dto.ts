import { IsNotEmpty, IsNumber, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBusinessRulesDto {
  @ApiProperty({ description: 'Bonus accordé au testeur', example: 5.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  testerBonus: number;

  @ApiProperty({ description: 'Commission SuperTry', example: 5.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supertryCommission: number;

  @ApiProperty({ description: 'Prix d\'une vidéo UGC', example: 20.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcVideoPrice: number;

  @ApiProperty({ description: 'Commission sur vidéo UGC', example: 5.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcVideoCommission: number;

  @ApiProperty({ description: 'Prix d\'une photo UGC', example: 10.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcPhotoPrice: number;

  @ApiProperty({ description: 'Commission sur photo UGC', example: 3.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ugcPhotoCommission: number;

  @ApiProperty({ description: 'Pourcentage de commission sur les pourboires', example: 10 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  tipCommissionPercent: number;

  // Règles d'annulation PRO
  @ApiProperty({ description: 'Délai de grâce pour l\'activation d\'une campagne (en minutes)', example: 60 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  campaignActivationGracePeriodMinutes: number;

  @ApiProperty({ description: 'Pourcentage de frais d\'annulation de campagne', example: 10 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  campaignCancellationFeePercent: number;

  // Règles d'annulation TESTEUR
  @ApiProperty({ description: 'Nombre de jours de bannissement en cas d\'annulation testeur', example: 14 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  testerCancellationBanDays: number;

  @ApiProperty({ description: 'Pourcentage de commission en cas d\'annulation testeur', example: 50 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  testerCancellationCommissionPercent: number;

  // Compensation testeur
  @ApiProperty({ description: 'Compensation du testeur en cas d\'annulation par le PRO', example: 5.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  testerCompensationOnProCancellation: number;

  // Commission hybride
  @ApiProperty({ description: 'Frais fixes de commission', example: 5.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commissionFixedFee: number;

  @ApiProperty({ description: 'Pourcentage de frais Stripe', example: 0.035 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  stripeFeePercent: number;

  @ApiProperty({ description: 'Délai avant capture du paiement (en minutes)', example: 60 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  captureDelayMinutes: number;

  // Règles UGC
  @ApiProperty({ description: 'Nombre maximum de rejets UGC', example: 3 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUgcRejections: number;

  @ApiProperty({ description: 'Délai par défaut pour livrer un UGC (en jours)', example: 7 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ugcDefaultDeadlineDays: number;

  // KYC testeur : nombre de tests réussis avant obligation KYC Identity
  @ApiProperty({ description: 'Nombre de tests réussis avant obligation KYC Identity', example: 3 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  kycRequiredAfterTests: number;

  // Gamification - prix max produit par palier
  @ApiProperty({ description: 'Prix max produit pour palier Bronze', example: 30.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tierBronzeMaxProductPrice: number;

  @ApiProperty({ description: 'Prix max produit pour palier Argent', example: 60.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tierSilverMaxProductPrice: number;

  @ApiProperty({ description: 'Prix max produit pour palier Or', example: 120.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tierGoldMaxProductPrice: number;

  @ApiProperty({ description: 'Prix max produit pour palier Platine', example: 250.0 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tierPlatinumMaxProductPrice: number;

  @ApiProperty({ description: 'Prix max produit pour palier Diamant', example: 99999 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tierDiamondMaxProductPrice: number;

  // Gamification - XP par événement
  @ApiProperty({ description: 'XP de base par test complété', example: 100 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  xpTestCompleted: number;

  @ApiProperty({ description: 'XP bonus pour note 4+/5', example: 50 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  xpHighRatingBonus: number;

  @ApiProperty({ description: 'XP bonus supplémentaire pour note 5/5', example: 30 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  xpPerfectRatingBonus: number;

  @ApiProperty({ description: 'XP bonus pour campagne à bonus minimum', example: 40 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  xpLowBonusAltruism: number;

  @ApiProperty({ description: 'XP bonus streak (3+ tests en 30j)', example: 75 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  xpStreakBonus: number;

  @ApiProperty({ description: 'XP bonus premier test', example: 100 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  xpFirstTestBonus: number;
}
