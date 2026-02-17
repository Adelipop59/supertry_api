import { ApiProperty } from '@nestjs/swagger';

export class BusinessRulesResponseDto {
  @ApiProperty({ description: 'Identifiant unique', example: 'clx1234567890' })
  id: string;

  @ApiProperty({ description: 'Bonus accordé au testeur', example: 5.0 })
  testerBonus: number;

  @ApiProperty({ description: 'Commission SuperTry', example: 5.0 })
  supertryCommission: number;

  @ApiProperty({ description: 'Prix d\'une vidéo UGC', example: 20.0 })
  ugcVideoPrice: number;

  @ApiProperty({ description: 'Commission sur vidéo UGC', example: 5.0 })
  ugcVideoCommission: number;

  @ApiProperty({ description: 'Prix d\'une photo UGC', example: 10.0 })
  ugcPhotoPrice: number;

  @ApiProperty({ description: 'Commission sur photo UGC', example: 3.0 })
  ugcPhotoCommission: number;

  @ApiProperty({ description: 'Pourcentage de commission sur les pourboires', example: 10 })
  tipCommissionPercent: number;

  // Règles d'annulation PRO
  @ApiProperty({ description: 'Délai de grâce pour l\'activation d\'une campagne (en minutes)', example: 60 })
  campaignActivationGracePeriodMinutes: number;

  @ApiProperty({ description: 'Pourcentage de frais d\'annulation de campagne', example: 10 })
  campaignCancellationFeePercent: number;

  // Règles d'annulation TESTEUR
  @ApiProperty({ description: 'Nombre de jours de bannissement en cas d\'annulation testeur', example: 14 })
  testerCancellationBanDays: number;

  @ApiProperty({ description: 'Pourcentage de commission en cas d\'annulation testeur', example: 50 })
  testerCancellationCommissionPercent: number;

  // Compensation testeur
  @ApiProperty({ description: 'Compensation du testeur en cas d\'annulation par le PRO', example: 5.0 })
  testerCompensationOnProCancellation: number;

  // Commission hybride
  @ApiProperty({ description: 'Frais fixes de commission', example: 5.0 })
  commissionFixedFee: number;

  @ApiProperty({ description: 'Pourcentage de frais Stripe', example: 0.035 })
  stripeFeePercent: number;

  @ApiProperty({ description: 'Délai avant capture du paiement (en minutes)', example: 60 })
  captureDelayMinutes: number;

  // Règles UGC
  @ApiProperty({ description: 'Nombre maximum de rejets UGC', example: 3 })
  maxUgcRejections: number;

  @ApiProperty({ description: 'Délai par défaut pour livrer un UGC (en jours)', example: 7 })
  ugcDefaultDeadlineDays: number;

  // KYC testeur
  @ApiProperty({ description: 'Nombre de tests réussis avant obligation KYC Identity', example: 3 })
  kycRequiredAfterTests: number;

  @ApiProperty({ description: 'Date de création', example: '2025-01-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de dernière mise à jour', example: '2025-01-15T10:30:00.000Z' })
  updatedAt: Date;
}
