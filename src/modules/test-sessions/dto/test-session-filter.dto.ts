import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { SessionStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class TestSessionFilterDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
