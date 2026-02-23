import { IsEnum, IsOptional } from 'class-validator';
import { XpEventType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class XpHistoryFilterDto extends PaginationDto {
  @IsOptional()
  @IsEnum(XpEventType)
  type?: XpEventType;
}
