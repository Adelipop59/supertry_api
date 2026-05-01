import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsBoolean,
  IsArray,
  IsOptional,
  IsUUID,
  ArrayMinSize,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateStepDto } from './create-step.dto';

export class CreateProcedureDto {
  @ApiProperty({ description: 'Titre de la procédure', example: 'Procédure de test produit' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ description: 'Description de la procédure', example: 'Tester toutes les fonctionnalités du produit' })
  @IsOptional()
  @IsString()
  description?: string;

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
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateStepDto)
  steps: CreateStepDto[];

  @ApiPropertyOptional({ description: 'ID du template de procédure source (lien vers ProcedureTemplate)', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID()
  procedureTemplateId?: string;
}
