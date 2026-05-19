import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class TipFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filtrer par ID de session',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
