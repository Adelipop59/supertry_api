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
import { CampaignMarketplaceMode } from '@prisma/client';
import { CreateOfferDto } from './create-offer.dto';
import { CreateProcedureDto } from './create-procedure.dto';
import { CreateCampaignCriteriaDto } from './create-criteria.dto';
import { CreateDistributionDto } from './create-distribution.dto';

export class CreateCampaignDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNotEmpty()
  @IsUUID()
  categoryId: string;

  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalSlots: number;

  @IsNotEmpty()
  @IsBoolean()
  autoAcceptApplications: boolean;

  @IsNotEmpty()
  @IsEnum(CampaignMarketplaceMode)
  marketplaceMode: CampaignMarketplaceMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2, { each: true })
  marketplaces?: string[]; // ['FR', 'DE', 'UK', etc.]

  @ValidateIf((o) => o.marketplaceMode === 'PRODUCT_LINK')
  @IsNotEmpty()
  @IsUrl()
  amazonLink?: string; // Required if PRODUCT_LINK

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  // Nested objects
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateOfferDto)
  offer: CreateOfferDto;

  @ValidateIf((o) => o.marketplaceMode === 'PROCEDURES')
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProcedureDto)
  procedures?: CreateProcedureDto[]; // Required if PROCEDURES

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCampaignCriteriaDto)
  criteria?: CreateCampaignCriteriaDto;

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDistributionDto)
  distributions: CreateDistributionDto[];
}
