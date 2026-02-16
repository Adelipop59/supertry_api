import { IsOptional, IsDateString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum RevenueGranularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class RevenueQueryDto {
  @ApiPropertyOptional({ description: 'Date de début (ISO)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Date de fin (ISO)', example: '2026-02-28' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: RevenueGranularity, default: RevenueGranularity.DAY })
  @IsOptional()
  @IsEnum(RevenueGranularity)
  granularity?: RevenueGranularity = RevenueGranularity.DAY;
}
