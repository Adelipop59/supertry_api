import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitUgcDto {
  @ApiPropertyOptional({
    description: 'Commentaire accompagnant la soumission',
    example: 'Voici ma vidéo de test du produit, tournée en extérieur',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({
    description:
      'URL du contenu pour TEXT_REVIEW (texte) ou EXTERNAL_REVIEW (lien). Pour VIDEO/PHOTO, utiliser le file upload multipart.',
    example: 'https://example.com/ugc-video.mp4',
  })
  /** Pour TEXT_REVIEW (texte) ou EXTERNAL_REVIEW (URL). Pour VIDEO/PHOTO, utiliser le file upload multipart. */
  @IsOptional()
  @IsString()
  contentUrl?: string;
}
