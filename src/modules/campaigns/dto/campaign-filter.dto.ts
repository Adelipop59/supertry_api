import {
  IsOptional,
  IsUUID,
  IsString,
  IsEnum,
  IsNumber,
  IsIn,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export type CampaignSortBy = 'createdAt' | 'startDate' | 'endDate';
export type CampaignSortDir = 'asc' | 'desc';

export class CampaignFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filtrer par catégorie', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Recherche texte', example: 'samsung' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrer par statut', enum: ['DRAFT', 'PENDING_ACTIVATION', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'], example: 'ACTIVE' })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @ApiPropertyOptional({ description: 'Bonus minimum', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minBonus?: number;

  @ApiPropertyOptional({ description: 'Bonus maximum', example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxBonus?: number;

  @ApiPropertyOptional({ description: 'Champ de tri', enum: ['createdAt', 'startDate', 'endDate'], example: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'startDate', 'endDate'])
  sortBy?: CampaignSortBy;

  @ApiPropertyOptional({ description: 'Ordre de tri', enum: ['asc', 'desc'], example: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: CampaignSortDir;
}
