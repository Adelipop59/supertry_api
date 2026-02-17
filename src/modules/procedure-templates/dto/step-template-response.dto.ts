import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StepType } from '@prisma/client';

export class StepTemplateResponseDto {
  @ApiProperty({ description: 'ID unique de l\'étape', example: '550e8400-e29b-41d4-a716-446655440010' })
  id: string;

  @ApiProperty({ description: 'ID du template de procédure parent', example: '550e8400-e29b-41d4-a716-446655440001' })
  procedureTemplateId: string;

  @ApiProperty({ description: 'Titre de l\'étape', example: 'Prendre une photo du produit déballé' })
  title: string;

  @ApiPropertyOptional({ description: 'Description de l\'étape', example: 'Prenez une photo claire du produit' })
  description?: string;

  @ApiProperty({ description: 'Type de l\'étape', enum: ['CHECKLIST', 'PHOTO', 'VIDEO', 'TEXT', 'SCREENSHOT', 'LINK'], example: 'PHOTO' })
  type: StepType;

  @ApiProperty({ description: 'Ordre d\'affichage', example: 0 })
  order: number;

  @ApiProperty({ description: 'Étape obligatoire', example: true })
  isRequired: boolean;

  @ApiPropertyOptional({ description: 'Éléments de checklist', example: { items: ['Vérifier', 'Tester'] } })
  checklistItems?: any;

  @ApiProperty({ description: 'Date de création', example: '2026-01-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de dernière modification', example: '2026-01-20T14:00:00.000Z' })
  updatedAt: Date;
}
