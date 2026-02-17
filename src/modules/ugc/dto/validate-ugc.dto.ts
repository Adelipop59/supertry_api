import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ValidateUgcDto {
  @ApiPropertyOptional({
    description: 'Commentaire de validation du UGC par le vendeur',
    example: 'Excellent contenu, merci pour la qualité de la vidéo',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  validationComment?: string;
}
