import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionStepProgressResponseDto {
  @ApiProperty({
    description: 'Identifiant unique de la progression d\'étape',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  id: string;

  @ApiProperty({
    description: 'Identifiant de la session de test associée',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  sessionId: string;

  @ApiProperty({
    description: 'Identifiant de l\'étape du test',
    example: '550e8400-e29b-41d4-a716-446655440020',
  })
  stepId: string;

  @ApiProperty({
    description: 'Détails de l\'étape du test',
    example: { id: '550e8400-e29b-41d4-a716-446655440020', title: 'Prendre une photo du produit', type: 'PHOTO', order: 1 },
  })
  step: {
    id: string;
    title: string;
    type: string;
    order: number;
  };

  @ApiProperty({
    description: 'Indique si l\'étape a été complétée',
    example: true,
  })
  isCompleted: boolean;

  @ApiPropertyOptional({
    description: 'Date de complétion de l\'étape',
    example: '2026-03-15T14:30:00.000Z',
  })
  completedAt?: Date;

  @ApiPropertyOptional({
    description: 'Données soumises pour cette étape',
    example: { comment: 'Produit testé avec succès', photos: ['https://example.com/photo1.jpg'] },
  })
  submissionData?: any;

  @ApiProperty({
    description: 'Date de création de la progression',
    example: '2026-03-10T10:00:00.000Z',
  })
  createdAt: Date;
}
