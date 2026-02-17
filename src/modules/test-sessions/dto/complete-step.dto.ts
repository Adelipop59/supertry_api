import { IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteStepDto {
  @ApiProperty({
    description: 'Données de soumission pour l\'étape (photos/vidéos/texte/checklist/notation selon le type d\'étape)',
    example: { comment: 'Produit testé avec succès', photos: ['https://example.com/photo1.jpg'] },
  })
  @IsNotEmpty()
  @IsObject()
  submissionData: any; // JSON data: photos/videos/text/checklist/rating based on StepType
}
