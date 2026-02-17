import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateStepDto } from './create-step.dto';

export class CreateProcedureDto {
  @ApiProperty({ description: 'Titre de la procédure', example: 'Procédure de test produit' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: 'Description de la procédure', example: 'Tester toutes les fonctionnalités du produit' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'Ordre d\'affichage', example: 1 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order: number;

  @ApiProperty({ description: 'Procédure obligatoire', example: true })
  @IsNotEmpty()
  @IsBoolean()
  isRequired: boolean;

  @ApiProperty({ description: 'Étapes de la procédure', type: () => [CreateStepDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStepDto)
  steps: CreateStepDto[];
}
