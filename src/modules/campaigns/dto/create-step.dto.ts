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

export class CreateStepDto {
  @ApiProperty({ description: 'Titre de l\'étape', example: 'Prendre une photo du produit' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ description: 'Description de l\'étape', example: 'Photo du produit déballé avec emballage visible' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Type d\'étape', enum: StepType, example: 'PHOTO' })
  @IsNotEmpty()
  @IsEnum(StepType)
  type: StepType;

  @ApiProperty({ description: 'Ordre d\'affichage', example: 1 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order: number;

  @ApiProperty({ description: 'Étape obligatoire', example: true })
  @IsNotEmpty()
  @IsBoolean()
  isRequired: boolean;

  @ApiPropertyOptional({ description: 'Éléments de checklist', example: { items: ['Item 1', 'Item 2'] } })
  @IsOptional()
  @IsObject()
  checklistItems?: any;
}
