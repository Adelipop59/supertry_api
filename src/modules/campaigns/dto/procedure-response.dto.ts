import { ApiProperty } from '@nestjs/swagger';
import { StepResponseDto } from './step-response.dto';

export class ProcedureResponseDto {
  @ApiProperty({ description: 'ID de la procédure', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'ID de la campagne', example: '550e8400-e29b-41d4-a716-446655440001' })
  campaignId: string;

  @ApiProperty({ description: 'Titre de la procédure', example: 'Procédure de test produit' })
  title: string;

  @ApiProperty({ description: 'Description de la procédure', example: 'Tester toutes les fonctionnalités du produit' })
  description: string;

  @ApiProperty({ description: 'Ordre d\'affichage', example: 1 })
  order: number;

  @ApiProperty({ description: 'Procédure obligatoire', example: true })
  isRequired: boolean;

  @ApiProperty({ description: 'Étapes de la procédure', type: () => [StepResponseDto] })
  steps: StepResponseDto[];

  @ApiProperty({ description: 'Date de création', example: '2026-02-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de mise à jour', example: '2026-02-16T14:00:00.000Z' })
  updatedAt: Date;
}
