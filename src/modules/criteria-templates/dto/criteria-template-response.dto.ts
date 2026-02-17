import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CriteriaTemplateResponseDto {
  @ApiProperty({ description: 'ID unique du template', example: '550e8400-e29b-41d4-a716-446655440001' })
  id: string;

  @ApiProperty({ description: 'ID du vendeur propriétaire', example: '550e8400-e29b-41d4-a716-446655440002' })
  sellerId: string;

  @ApiProperty({ description: 'Nom du template', example: 'Testeurs premium France' })
  name: string;

  @ApiPropertyOptional({ description: 'Âge minimum', example: 18 })
  minAge?: number;

  @ApiPropertyOptional({ description: 'Âge maximum', example: 45 })
  maxAge?: number;

  @ApiPropertyOptional({ description: 'Note minimum', example: 3.5 })
  minRating?: number;

  @ApiPropertyOptional({ description: 'Note maximum', example: 5 })
  maxRating?: number;

  @ApiPropertyOptional({ description: 'Sessions complétées minimum', example: 5 })
  minCompletedSessions?: number;

  @ApiPropertyOptional({ description: 'Genre requis', example: 'FEMALE' })
  requiredGender?: string;

  @ApiProperty({ description: 'Pays requis', example: ['FR', 'BE'], type: [String] })
  requiredCountries: string[];

  @ApiProperty({ description: 'Localisations requises', example: ['Paris'], type: [String] })
  requiredLocations: string[];

  @ApiProperty({ description: 'Localisations exclues', example: ['Corse'], type: [String] })
  excludedLocations: string[];

  @ApiProperty({ description: 'Catégories requises', example: ['Électronique'], type: [String] })
  requiredCategories: string[];

  @ApiProperty({ description: 'Interdire session active avec ce vendeur', example: true })
  noActiveSessionWithSeller: boolean;

  @ApiPropertyOptional({ description: 'Max sessions par semaine', example: 3 })
  maxSessionsPerWeek?: number;

  @ApiPropertyOptional({ description: 'Max sessions par mois', example: 10 })
  maxSessionsPerMonth?: number;

  @ApiPropertyOptional({ description: 'Taux de complétion minimum (%)', example: 80 })
  minCompletionRate?: number;

  @ApiPropertyOptional({ description: 'Taux d\'annulation maximum (%)', example: 10 })
  maxCancellationRate?: number;

  @ApiPropertyOptional({ description: 'Âge minimum du compte (jours)', example: 30 })
  minAccountAge?: number;

  @ApiPropertyOptional({ description: 'Dernière activité dans les X jours', example: 7 })
  lastActiveWithinDays?: number;

  @ApiProperty({ description: 'Compte vérifié requis', example: true })
  requireVerified: boolean;

  @ApiProperty({ description: 'Compte Prime requis', example: false })
  requirePrime: boolean;

  @ApiProperty({ description: 'Date de création', example: '2026-01-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de dernière modification', example: '2026-01-20T14:00:00.000Z' })
  updatedAt: Date;
}
