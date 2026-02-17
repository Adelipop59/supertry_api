import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsUUID,
  IsInt,
  IsBoolean,
  IsEnum,
  IsArray,
  IsDateString,
  IsUrl,
  ValidateNested,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignMarketplaceMode } from '@prisma/client';
import { CreateOfferDto } from './create-offer.dto';
import { CreateProcedureDto } from './create-procedure.dto';
import { CreateCampaignCriteriaDto } from './create-criteria.dto';
import { CreateDistributionDto } from './create-distribution.dto';

export class CreateCampaignDto {
  @ApiProperty({ description: 'Titre de la campagne', example: 'Test Samsung Galaxy S24' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: 'Description détaillée', example: 'Campagne de test pour le nouveau Samsung Galaxy S24 Ultra' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'ID de la catégorie', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsNotEmpty()
  @IsUUID()
  categoryId: string;

  @ApiProperty({ description: 'Date de début', example: '2026-03-01' })
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ description: 'Date de fin', example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ description: 'Nombre de testeurs', example: 10 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalSlots: number;

  @ApiProperty({ description: 'Acceptation auto des candidatures', example: true })
  @IsNotEmpty()
  @IsBoolean()
  autoAcceptApplications: boolean;

  @ApiProperty({ description: 'Mode marketplace', enum: ['KEYWORDS', 'PRODUCT_LINK', 'PROCEDURES'], example: 'KEYWORDS' })
  @IsNotEmpty()
  @IsEnum(CampaignMarketplaceMode)
  marketplaceMode: CampaignMarketplaceMode;

  @ApiPropertyOptional({ description: 'Marketplaces cibles', example: ['FR', 'DE'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2, { each: true })
  marketplaces?: string[]; // ['FR', 'DE', 'UK', etc.]

  @ApiPropertyOptional({ description: 'Lien Amazon du produit', example: 'https://www.amazon.fr/dp/B0CSD7H7K3' })
  @ValidateIf((o) => o.marketplaceMode === 'PRODUCT_LINK')
  @IsNotEmpty()
  @IsUrl()
  amazonLink?: string; // Required if PRODUCT_LINK

  @ApiPropertyOptional({ description: 'Mots-clés de recherche', example: ['samsung', 'galaxy', 's24'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  // Nested objects
  @ApiProperty({ description: 'Offre de la campagne', type: () => CreateOfferDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateOfferDto)
  offer: CreateOfferDto;

  @ApiPropertyOptional({ description: 'Procédures de test', type: () => [CreateProcedureDto] })
  @ValidateIf((o) => o.marketplaceMode === 'PROCEDURES')
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProcedureDto)
  procedures?: CreateProcedureDto[]; // Required if PROCEDURES

  @ApiPropertyOptional({ description: 'Critères d éligibilité', type: () => CreateCampaignCriteriaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCampaignCriteriaDto)
  criteria?: CreateCampaignCriteriaDto;

  @ApiProperty({ description: 'Distribution des slots', type: () => [CreateDistributionDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDistributionDto)
  distributions: CreateDistributionDto[];
}
