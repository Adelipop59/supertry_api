import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
  Min,
  MaxLength,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StepType } from '@prisma/client';

export class CreateStepTemplateDto {
  @ApiProperty({
    description: 'Titre de l\'étape',
    example: 'Prendre une photo du produit déballé',
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({
    description: 'Description détaillée de l\'étape',
    example: 'Prenez une photo claire du produit une fois sorti de son emballage, sur un fond neutre',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Type de l\'étape',
    enum: ['CHECKLIST', 'PHOTO', 'VIDEO', 'TEXT', 'SCREENSHOT', 'LINK'],
    example: 'PHOTO',
  })
  @IsNotEmpty()
  @IsEnum(StepType)
  type: StepType;

  @ApiProperty({
    description: 'Ordre d\'affichage de l\'étape (commence à 0)',
    example: 0,
    minimum: 0,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order: number;

  @ApiProperty({
    description: 'Indique si l\'étape est obligatoire',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  isRequired: boolean;

  @ApiPropertyOptional({
    description: 'Éléments de checklist (pour le type CHECKLIST)',
    example: { items: ['Vérifier l\'emballage', 'Tester le produit', 'Prendre une photo'] },
  })
  @IsOptional()
  @IsObject()
  checklistItems?: any;
}
