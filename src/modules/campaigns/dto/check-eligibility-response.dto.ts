import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckEligibilityResponseDto {
  @ApiProperty({ description: 'Le testeur est-il éligible', example: true })
  eligible: boolean;

  @ApiPropertyOptional({ description: 'Raisons de non-éligibilité', example: ['Âge minimum non atteint', 'Pays non autorisé'] })
  reasons?: string[];
}
