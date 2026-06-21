import { IsArray, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';
import { Transform } from 'class-transformer';
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
      'URL du contenu pour TEXT_REVIEW (texte) ou EXTERNAL_REVIEW (lien).',
    example: 'https://example.com/ugc-video.mp4',
  })
  @IsOptional()
  @IsString()
  contentUrl?: string;

  @ApiPropertyOptional({
    description:
      'Clés S3 des fichiers déjà uploadés en direct (VIDEO: 1 clé ; PHOTO: 1 à 8 clés). Alternative au file upload multipart.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  keys?: string[];

  @ApiPropertyOptional({
    description: 'Clé S3 de la vignette/poster (VIDEO), uploadée en direct',
  })
  @IsOptional()
  @IsString()
  thumbnailKey?: string;
}
