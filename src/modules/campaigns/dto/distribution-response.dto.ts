import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DistributionType } from '@prisma/client';

export class DistributionResponseDto {
  @ApiProperty({ description: 'ID de la distribution', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'ID de la campagne', example: '550e8400-e29b-41d4-a716-446655440001' })
  campaignId: string;

  @ApiProperty({ description: 'Type de distribution', enum: DistributionType, example: 'DAILY' })
  type: DistributionType;

  @ApiPropertyOptional({ description: 'Jour de la semaine (0-6)', example: 1 })
  dayOfWeek?: number;

  @ApiPropertyOptional({ description: 'Date spécifique', example: '2026-03-15T00:00:00.000Z' })
  specificDate?: Date;

  @ApiProperty({ description: 'Nombre maximum d\'unités', example: 3 })
  maxUnits: number;

  @ApiProperty({ description: 'Distribution active', example: true })
  isActive: boolean;

  @ApiProperty({ description: 'Date de création', example: '2026-02-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de mise à jour', example: '2026-02-16T14:00:00.000Z' })
  updatedAt: Date;
}
