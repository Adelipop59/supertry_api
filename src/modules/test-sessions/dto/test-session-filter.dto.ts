import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { SessionStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class TestSessionFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filtrer par identifiant de campagne',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({
    description: 'Filtrer par statut de la session',
    example: 'IN_PROGRESS',
    enum: SessionStatus,
  })
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
