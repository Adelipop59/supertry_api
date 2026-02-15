export class BusinessRulesResponseDto {
  id: string;
  testerBonus: number;
  supertryCommission: number;
  ugcVideoPrice: number;
  ugcVideoCommission: number;
  ugcPhotoPrice: number;
  ugcPhotoCommission: number;
  tipCommissionPercent: number;

  // Règles d'annulation PRO
  campaignActivationGracePeriodMinutes: number;
  campaignCancellationFeePercent: number;

  // Règles d'annulation TESTEUR
  testerCancellationBanDays: number;
  testerCancellationCommissionPercent: number;

  // Compensation testeur
  testerCompensationOnProCancellation: number;

  // Commission hybride
  commissionFixedFee: number;
  stripeFeePercent: number;
  captureDelayMinutes: number;

  // Règles UGC
  maxUgcRejections: number;
  ugcDefaultDeadlineDays: number;

  // KYC testeur
  kycRequiredAfterTests: number;

  createdAt: Date;
  updatedAt: Date;
}
