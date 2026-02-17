import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaFolder, MediaType } from '../media.service';

export class UploadFileDto {
  @ApiProperty({
    description: 'Dossier de destination du fichier',
    enum: MediaFolder,
    example: 'products',
  })
  @IsEnum(MediaFolder)
  folder: MediaFolder;

  @ApiProperty({
    description: 'Type de média (image, vidéo, document, etc.)',
    enum: MediaType,
    example: 'image',
  })
  @IsEnum(MediaType)
  mediaType: MediaType;

  @ApiPropertyOptional({
    description: 'Sous-dossier optionnel pour organiser les fichiers',
    example: 'thumbnails',
  })
  @IsOptional()
  @IsString()
  subfolder?: string;

  @ApiPropertyOptional({
    description: 'Nom de fichier personnalisé (sans extension)',
    example: 'mon-produit-photo-1',
  })
  @IsOptional()
  @IsString()
  customFilename?: string;

  @ApiPropertyOptional({
    description: 'Rendre le fichier accessible publiquement',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  makePublic?: boolean;
}
