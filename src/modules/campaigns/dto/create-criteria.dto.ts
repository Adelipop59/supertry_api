import {
  IsOptional,
  IsInt,
  IsNumber,
  IsBoolean,
  IsArray,
  IsString,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCampaignCriteriaDto {
  @ApiPropertyOptional({ description: 'Âge minimum', example: 18 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  minAge?: number;

  @ApiPropertyOptional({ description: 'Âge maximum', example: 65 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  maxAge?: number;

  @ApiPropertyOptional({ description: 'Note minimum', example: 3.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ description: 'Note maximum', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  maxRating?: number;

  @ApiPropertyOptional({ description: 'Nombre minimum de sessions complétées', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCompletedSessions?: number;

  @ApiPropertyOptional({ description: 'Genre requis', example: 'female' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  requiredGender?: string;

  @ApiPropertyOptional({ description: 'Pays requis', example: ['FR', 'BE'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredCountries?: string[];

  @ApiPropertyOptional({ description: 'Localisations requises', example: ['Paris', 'Lyon'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredLocations?: string[];

  @ApiPropertyOptional({ description: 'Localisations exclues', example: ['Marseille'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedLocations?: string[];

  @ApiPropertyOptional({ description: 'Catégories requises', example: ['Électronique'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredCategories?: string[];

  @ApiPropertyOptional({ description: 'Pas de session active avec le vendeur', example: true })
  @IsOptional()
  @IsBoolean()
  noActiveSessionWithSeller?: boolean;

  @ApiPropertyOptional({ description: 'Nombre maximum de sessions par semaine', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSessionsPerWeek?: number;

  @ApiPropertyOptional({ description: 'Nombre maximum de sessions par mois', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSessionsPerMonth?: number;

  @ApiPropertyOptional({ description: 'Taux de complétion minimum (%)', example: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minCompletionRate?: number;

  @ApiPropertyOptional({ description: 'Taux d\'annulation maximum (%)', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxCancellationRate?: number;

  @ApiPropertyOptional({ description: 'Âge minimum du compte (jours)', example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAccountAge?: number;

  @ApiPropertyOptional({ description: 'Dernière activité dans les X jours', example: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lastActiveWithinDays?: number;

  @ApiPropertyOptional({ description: 'Compte vérifié requis', example: true })
  @IsOptional()
  @IsBoolean()
  requireVerified?: boolean;

  @ApiPropertyOptional({ description: 'Compte Prime requis', example: false })
  @IsOptional()
  @IsBoolean()
  requirePrime?: boolean;
}
