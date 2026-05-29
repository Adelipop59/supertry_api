import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApplyToCampaignDto {
  @ApiPropertyOptional({
    description: 'Message de candidature du testeur pour la campagne',
    example: 'Je suis très intéressé par ce produit, je l\'utilise quotidiennement depuis 2 ans.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  applicationMessage?: string;

  @ApiPropertyOptional({
    description:
      'ID de la distribution (date) choisie par le testeur. Si omis, la prochaine date disponible est auto-assignée.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  distributionId?: string;
}
