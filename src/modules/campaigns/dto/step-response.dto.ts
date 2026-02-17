import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StepType } from '@prisma/client';

export class StepResponseDto {
  @ApiProperty({ description: 'ID de l\'étape', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'ID de la procédure', example: '550e8400-e29b-41d4-a716-446655440001' })
  procedureId: string;

  @ApiProperty({ description: 'Titre de l\'étape', example: 'Prendre une photo du produit' })
  title: string;

  @ApiPropertyOptional({ description: 'Description de l\'étape', example: 'Photo du produit déballé avec emballage visible' })
  description?: string;

  @ApiProperty({ description: 'Type d\'étape', enum: StepType, example: 'PHOTO' })
  type: StepType;

  @ApiProperty({ description: 'Ordre d\'affichage', example: 1 })
  order: number;

  @ApiProperty({ description: 'Étape obligatoire', example: true })
  isRequired: boolean;

  @ApiPropertyOptional({ description: 'Éléments de checklist', example: { items: ['Item 1', 'Item 2'] } })
  checklistItems?: any;

  @ApiProperty({ description: 'Date de création', example: '2026-02-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de mise à jour', example: '2026-02-16T14:00:00.000Z' })
  updatedAt: Date;
}
