import {
  IsOptional,
  IsUUID,
  IsString,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CampaignStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CampaignFilterDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minBonus?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxBonus?: number;
}
