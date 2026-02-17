import { IsOptional, IsString, MaxLength } from 'class-validator';
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
}
