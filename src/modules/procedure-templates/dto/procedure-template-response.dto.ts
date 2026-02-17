import { ApiProperty } from '@nestjs/swagger';
import { StepTemplateResponseDto } from './step-template-response.dto';

export class ProcedureTemplateResponseDto {
  @ApiProperty({ description: 'ID unique du template de procédure', example: '550e8400-e29b-41d4-a716-446655440001' })
  id: string;

  @ApiProperty({ description: 'ID du vendeur propriétaire', example: '550e8400-e29b-41d4-a716-446655440002' })
  sellerId: string;

  @ApiProperty({ description: 'Nom interne du template', example: 'Procédure test smartphone' })
  name: string;

  @ApiProperty({ description: 'Titre affiché', example: 'Comment tester votre nouveau smartphone' })
  title: string;

  @ApiProperty({ description: 'Description de la procédure', example: 'Suivez ces étapes pour tester correctement le smartphone' })
  description: string;

  @ApiProperty({ description: 'Liste des étapes', type: [StepTemplateResponseDto] })
  steps: StepTemplateResponseDto[];

  @ApiProperty({ description: 'Date de création', example: '2026-01-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de dernière modification', example: '2026-01-20T14:00:00.000Z' })
  updatedAt: Date;
}
