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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DistributionType } from '@prisma/client';

export class CreateDistributionDto {
  @ApiProperty({ description: 'Type de distribution', enum: DistributionType, example: 'DAILY' })
  @IsNotEmpty()
  @IsEnum(DistributionType)
  type: DistributionType;

  @ApiPropertyOptional({ description: 'Jour de la semaine (0-6)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number; // Required if type = RECURRING

  @ApiPropertyOptional({ description: 'Date spécifique', example: '2026-03-15' })
  @IsOptional()
  @IsDateString()
  specificDate?: string; // Required if type = SPECIFIC_DATE

  @ApiProperty({ description: 'Nombre maximum d\'unités', example: 3 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUnits: number;

  @ApiProperty({ description: 'Distribution active', example: true })
  @IsNotEmpty()
  @IsBoolean()
  isActive: boolean;
}
