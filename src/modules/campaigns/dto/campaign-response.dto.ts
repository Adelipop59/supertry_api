import { CampaignStatus, CampaignMarketplaceMode } from '@prisma/client';
import { OfferResponseDto } from './offer-response.dto';
import { ProcedureResponseDto } from './procedure-response.dto';
import { DistributionResponseDto } from './distribution-response.dto';
import { CampaignCriteriaResponseDto } from './criteria-response.dto';

export class CampaignResponseDto {
  id: string;
  sellerId: string;
  seller: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    avatar?: string;
  };
  categoryId?: string;
  category?: {
    id: string;
    name: string;
    slug: string;
    icon?: string;
  };
  title: string;
  description: string;
  startDate: Date;
  endDate?: Date;
  totalSlots: number;
  availableSlots: number;
  status: CampaignStatus;
  autoAcceptApplications: boolean;
  marketplaceMode: CampaignMarketplaceMode;
  marketplace?: string;
  amazonLink?: string;
  keywords: string[];
  escrowAmount: number;

  // Relations
  offers: OfferResponseDto[];
  procedures: ProcedureResponseDto[];
  distributions: DistributionResponseDto[];
  criteria?: CampaignCriteriaResponseDto;

  // Stats
  sessionsCount?: number;
  completedSessionsCount?: number;

  createdAt: Date;
  updatedAt: Date;
}
