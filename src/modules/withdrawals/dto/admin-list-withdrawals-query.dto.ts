import {
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsString,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WithdrawalStatus } from '@prisma/client';

export class AdminListWithdrawalsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;
}
