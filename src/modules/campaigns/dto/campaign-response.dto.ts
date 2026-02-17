import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus, CampaignMarketplaceMode } from '@prisma/client';
import { OfferResponseDto } from './offer-response.dto';
import { ProcedureResponseDto } from './procedure-response.dto';
import { DistributionResponseDto } from './distribution-response.dto';
import { CampaignCriteriaResponseDto } from './criteria-response.dto';

export class CampaignResponseDto {
  @ApiProperty({ description: 'ID de la campagne', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'ID du vendeur', example: '550e8400-e29b-41d4-a716-446655440001' })
  sellerId: string;

  @ApiProperty({ description: 'Informations du vendeur' })
  seller: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    avatar?: string;
  };

  @ApiPropertyOptional({ description: 'ID de la catégorie', example: '550e8400-e29b-41d4-a716-446655440002' })
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Informations de la catégorie' })
  category?: {
    id: string;
    name: string;
    slug: string;
    icon?: string;
  };

  @ApiProperty({ description: 'Titre de la campagne', example: 'Test Samsung Galaxy S24' })
  title: string;

  @ApiProperty({ description: 'Description de la campagne', example: 'Campagne de test pour le nouveau Samsung Galaxy S24 Ultra' })
  description: string;

  @ApiProperty({ description: 'Date de début', example: '2026-03-01T00:00:00.000Z' })
  startDate: Date;

  @ApiPropertyOptional({ description: 'Date de fin', example: '2026-04-01T00:00:00.000Z' })
  endDate?: Date;

  @ApiProperty({ description: 'Nombre total de slots', example: 10 })
  totalSlots: number;

  @ApiProperty({ description: 'Nombre de slots disponibles', example: 7 })
  availableSlots: number;

  @ApiProperty({ description: 'Statut de la campagne', enum: ['DRAFT', 'PENDING_ACTIVATION', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'], example: 'ACTIVE' })
  status: CampaignStatus;

  @ApiProperty({ description: 'Acceptation auto des candidatures', example: true })
  autoAcceptApplications: boolean;

  @ApiProperty({ description: 'Mode marketplace', enum: ['KEYWORDS', 'PRODUCT_LINK', 'PROCEDURES'], example: 'KEYWORDS' })
  marketplaceMode: CampaignMarketplaceMode;

  @ApiPropertyOptional({ description: 'Marketplace', example: 'FR' })
  marketplace?: string;

  @ApiPropertyOptional({ description: 'Lien Amazon', example: 'https://www.amazon.fr/dp/B0CSD7H7K3' })
  amazonLink?: string;

  @ApiProperty({ description: 'Mots-clés', example: ['samsung', 'galaxy', 's24'] })
  keywords: string[];

  @ApiProperty({ description: 'Montant séquestre', example: 150.00 })
  escrowAmount: number;

  // Relations
  @ApiProperty({ description: 'Offres de la campagne', type: () => [OfferResponseDto] })
  offers: OfferResponseDto[];

  @ApiProperty({ description: 'Procédures de la campagne', type: () => [ProcedureResponseDto] })
  procedures: ProcedureResponseDto[];

  @ApiProperty({ description: 'Distributions de la campagne', type: () => [DistributionResponseDto] })
  distributions: DistributionResponseDto[];

  @ApiPropertyOptional({ description: 'Critères d\'éligibilité', type: () => CampaignCriteriaResponseDto })
  criteria?: CampaignCriteriaResponseDto;

  // Stats
  @ApiPropertyOptional({ description: 'Nombre de sessions', example: 5 })
  sessionsCount?: number;

  @ApiPropertyOptional({ description: 'Nombre de sessions complétées', example: 3 })
  completedSessionsCount?: number;

  @ApiProperty({ description: 'Date de création', example: '2026-02-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de mise à jour', example: '2026-02-16T14:00:00.000Z' })
  updatedAt: Date;
}
