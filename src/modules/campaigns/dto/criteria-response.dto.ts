import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CampaignCriteriaResponseDto {
  @ApiProperty({ description: 'ID des critères', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'ID de la campagne', example: '550e8400-e29b-41d4-a716-446655440001' })
  campaignId: string;

  @ApiPropertyOptional({ description: 'Âge minimum', example: 18 })
  minAge?: number;

  @ApiPropertyOptional({ description: 'Âge maximum', example: 65 })
  maxAge?: number;

  @ApiPropertyOptional({ description: 'Note minimum', example: 3.5 })
  minRating?: number;

  @ApiPropertyOptional({ description: 'Note maximum', example: 5 })
  maxRating?: number;

  @ApiPropertyOptional({ description: 'Nombre minimum de sessions complétées', example: 5 })
  minCompletedSessions?: number;

  @ApiPropertyOptional({ description: 'Genre requis', example: 'female' })
  requiredGender?: string;

  @ApiProperty({ description: 'Pays requis', example: ['FR', 'BE'] })
  requiredCountries: string[];

  @ApiProperty({ description: 'Localisations requises', example: ['Paris', 'Lyon'] })
  requiredLocations: string[];

  @ApiProperty({ description: 'Localisations exclues', example: ['Marseille'] })
  excludedLocations: string[];

  @ApiProperty({ description: 'Catégories requises', example: ['Électronique'] })
  requiredCategories: string[];

  @ApiProperty({ description: 'Pas de session active avec le vendeur', example: true })
  noActiveSessionWithSeller: boolean;

  @ApiPropertyOptional({ description: 'Nombre maximum de sessions par semaine', example: 2 })
  maxSessionsPerWeek?: number;

  @ApiPropertyOptional({ description: 'Nombre maximum de sessions par mois', example: 5 })
  maxSessionsPerMonth?: number;

  @ApiPropertyOptional({ description: 'Taux de complétion minimum (%)', example: 80 })
  minCompletionRate?: number;

  @ApiPropertyOptional({ description: 'Taux d\'annulation maximum (%)', example: 10 })
  maxCancellationRate?: number;

  @ApiPropertyOptional({ description: 'Âge minimum du compte (jours)', example: 30 })
  minAccountAge?: number;

  @ApiPropertyOptional({ description: 'Dernière activité dans les X jours', example: 90 })
  lastActiveWithinDays?: number;

  @ApiProperty({ description: 'Compte vérifié requis', example: true })
  requireVerified: boolean;

  @ApiProperty({ description: 'Compte Prime requis', example: false })
  requirePrime: boolean;

  @ApiProperty({ description: 'Date de création', example: '2026-02-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de mise à jour', example: '2026-02-16T14:00:00.000Z' })
  updatedAt: Date;
}
