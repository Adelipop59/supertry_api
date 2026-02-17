import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCriteriaTemplateDto {
  @ApiProperty({
    description: 'Nom du template de critères',
    example: 'Testeurs premium France',
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description: 'Âge minimum du testeur',
    example: 18,
    minimum: 0,
    maximum: 120,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  minAge?: number;

  @ApiPropertyOptional({
    description: 'Âge maximum du testeur',
    example: 45,
    minimum: 0,
    maximum: 120,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  maxAge?: number;

  @ApiPropertyOptional({
    description: 'Note minimum du testeur',
    example: 3.5,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({
    description: 'Note maximum du testeur',
    example: 5,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  maxRating?: number;

  @ApiPropertyOptional({
    description: 'Nombre minimum de sessions complétées',
    example: 5,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCompletedSessions?: number;

  @ApiPropertyOptional({
    description: 'Genre requis du testeur',
    example: 'FEMALE',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  requiredGender?: string;

  @ApiPropertyOptional({
    description: 'Liste des pays requis (codes ISO)',
    example: ['FR', 'BE', 'CH'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredCountries?: string[];

  @ApiPropertyOptional({
    description: 'Liste des localisations requises',
    example: ['Paris', 'Lyon', 'Marseille'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredLocations?: string[];

  @ApiPropertyOptional({
    description: 'Liste des localisations exclues',
    example: ['Corse'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedLocations?: string[];

  @ApiPropertyOptional({
    description: 'Catégories de produits requises',
    example: ['Électronique', 'High-Tech'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredCategories?: string[];

  @ApiPropertyOptional({
    description: 'Interdire les testeurs ayant déjà une session active avec ce vendeur',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  noActiveSessionWithSeller?: boolean;

  @ApiPropertyOptional({
    description: 'Nombre maximum de sessions par semaine',
    example: 3,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSessionsPerWeek?: number;

  @ApiPropertyOptional({
    description: 'Nombre maximum de sessions par mois',
    example: 10,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSessionsPerMonth?: number;

  @ApiPropertyOptional({
    description: 'Taux de complétion minimum (%)',
    example: 80,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minCompletionRate?: number;

  @ApiPropertyOptional({
    description: 'Taux d\'annulation maximum (%)',
    example: 10,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxCancellationRate?: number;

  @ApiPropertyOptional({
    description: 'Âge minimum du compte (en jours)',
    example: 30,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAccountAge?: number;

  @ApiPropertyOptional({
    description: 'Dernière activité dans les X jours',
    example: 7,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lastActiveWithinDays?: number;

  @ApiPropertyOptional({
    description: 'Exiger un compte vérifié',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  requireVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Exiger un compte Prime',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  requirePrime?: boolean;
}
