import { SessionStatus, CampaignMarketplaceMode } from '@prisma/client';
import { SessionStepProgressResponseDto } from './session-step-progress-response.dto';

export class TestSessionResponseDto {
  id: string;
  campaignId: string;
  campaign: {
    id: string;
    title: string;
    marketplaceMode: CampaignMarketplaceMode;
    seller: {
      id: string;
      firstName: string;
      lastName: string;
    };
  };
  testerId: string;
  tester: {
    id: string;
    firstName: string;
    lastName: string;
    avatar?: string;
  };
  status: SessionStatus;

  // Application
  applicationMessage?: string;
  appliedAt: Date;

  // Acceptance
  acceptedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;

  // Purchase
  scheduledPurchaseDate?: Date;
  validatedProductPrice?: number;
  priceValidatedAt?: Date;
  priceValidationAttempts: number;
  productTitleSubmitted?: string;

  orderNumber?: string;
  productPrice?: number;
  shippingCost?: number;
  purchaseProofUrl?: string;
  purchasedAt?: Date;
  orderNumberValidatedAt?: Date;

  // Purchase validation (PRO)
  purchaseValidatedAt?: Date;
  purchaseValidationComment?: string;
  purchaseRejectedAt?: Date;
  purchaseRejectionReason?: string;

  // Progress
  stepProgress: SessionStepProgressResponseDto[];

  // Completion
  submittedAt?: Date;
  completedAt?: Date;
  rewardAmount?: number;

  // Cancellation
  cancelledAt?: Date;
  cancellationReason?: string;

  createdAt: Date;
  updatedAt: Date;
}
