import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTipDto {
  @ApiProperty({
    description: 'ID de la session liée au tip',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  sessionId: string;

  @ApiProperty({
    description: 'Montant du tip en euros (hors commission)',
    example: 10,
    minimum: 1,
    maximum: 500,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(500)
  amount: number;

  @ApiPropertyOptional({
    description: 'Message accompagnant le tip',
    example: 'Merci pour ton super travail !',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @ApiProperty({
    description: 'ID Stripe du moyen de paiement (paiement immédiat)',
    example: 'pm_1234567890abcdef',
  })
  @IsNotEmpty()
  @IsString()
  paymentMethodId: string;
}
