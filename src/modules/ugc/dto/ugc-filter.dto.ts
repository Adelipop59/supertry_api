import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { UGCStatus, UGCType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class UgcFilterDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsEnum(UGCStatus)
  status?: UGCStatus;

  @IsOptional()
  @IsEnum(UGCType)
  type?: UGCType;
}
