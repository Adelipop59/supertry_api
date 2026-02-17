import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateStepTemplateDto } from './create-step-template.dto';

export class CreateProcedureTemplateDto {
  @ApiProperty({
    description: 'Nom interne du template de procédure',
    example: 'Procédure test smartphone',
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Titre affiché de la procédure',
    example: 'Comment tester votre nouveau smartphone',
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    description: 'Description de la procédure de test',
    example: 'Suivez ces étapes pour tester correctement le smartphone et fournir un retour complet',
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Liste des étapes de la procédure',
    type: [CreateStepTemplateDto],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStepTemplateDto)
  steps: CreateStepTemplateDto[];
}
