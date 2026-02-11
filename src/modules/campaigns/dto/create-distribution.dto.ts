import {
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DistributionType } from '@prisma/client';

export class CreateDistributionDto {
  @IsNotEmpty()
  @IsEnum(DistributionType)
  type: DistributionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number; // Required if type = RECURRING

  @IsOptional()
  @IsDateString()
  specificDate?: string; // Required if type = SPECIFIC_DATE

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUnits: number;

  @IsNotEmpty()
  @IsBoolean()
  isActive: boolean;
}
