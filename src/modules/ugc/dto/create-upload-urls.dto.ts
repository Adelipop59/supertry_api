import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadFileSpecDto {
  @ApiProperty({ description: 'Nom de fichier original', example: 'unboxing.mp4' })
  @IsNotEmpty()
  @IsString()
  filename: string;

  @ApiProperty({ description: 'Content-Type du fichier', example: 'video/mp4' })
  @IsNotEmpty()
  @IsString()
  contentType: string;
}

export class CreateUploadUrlsDto {
  @ApiProperty({
    description: 'Fichiers de contenu à uploader (1 pour VIDEO, jusqu\'à 8 pour PHOTO)',
    type: [UploadFileSpecDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => UploadFileSpecDto)
  files: UploadFileSpecDto[];

  @ApiPropertyOptional({
    description: 'Vignette/poster optionnel (image) pour une VIDEO',
    type: UploadFileSpecDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UploadFileSpecDto)
  thumbnail?: UploadFileSpecDto;
}
