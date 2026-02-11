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
import { StepType } from '@prisma/client';

export class CreateStepTemplateDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsEnum(StepType)
  type: StepType;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order: number;

  @IsNotEmpty()
  @IsBoolean()
  isRequired: boolean;

  @IsOptional()
  @IsObject()
  checklistItems?: any;
}
