import { IsNotEmpty, IsString, MaxLength, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CancelCampaignDto {
  @ApiProperty({
    description: 'Raison de l\'annulation de la campagne',
    example: 'Le produit ne correspond pas à mes attentes',
    maxLength: 1000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  cancellationReason: string;

  @ApiPropertyOptional({
    description: 'Forcer l\'annulation (réservé aux administrateurs)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  forceCancel?: boolean;
}
