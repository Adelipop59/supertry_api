import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UGCStatus, UGCType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class UgcFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filtrer par ID de session',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Filtrer par statut UGC',
    enum: ['REQUESTED', 'SUBMITTED', 'VALIDATED', 'REJECTED', 'DISPUTED', 'CANCELLED', 'DECLINED'],
  })
  @IsOptional()
  @IsEnum(UGCStatus)
  status?: UGCStatus;

  @ApiPropertyOptional({
    description: 'Filtrer par type de UGC',
    enum: ['VIDEO', 'PHOTO', 'TEXT_REVIEW', 'EXTERNAL_REVIEW'],
  })
  @IsOptional()
  @IsEnum(UGCType)
  type?: UGCType;
}
