import { IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BalanceTransactionsQueryDto {
  @ApiPropertyOptional({ description: 'Nombre de résultats (1-100)', default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ description: 'Cursor Stripe pour pagination (après)' })
  @IsOptional()
  @IsString()
  startingAfter?: string;

  @ApiPropertyOptional({ description: 'Cursor Stripe pour pagination (avant)' })
  @IsOptional()
  @IsString()
  endingBefore?: string;

  @ApiPropertyOptional({ description: 'Date de début (ISO)', example: '2026-02-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Date de fin (ISO)', example: '2026-02-28' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Type Stripe: charge, transfer, refund, stripe_fee, etc.' })
  @IsOptional()
  @IsString()
  type?: string;
}
