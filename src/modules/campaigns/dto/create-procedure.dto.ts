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
import { CreateStepDto } from './create-step.dto';

export class CreateProcedureDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order: number;

  @IsNotEmpty()
  @IsBoolean()
  isRequired: boolean;

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStepDto)
  steps: CreateStepDto[];
}
