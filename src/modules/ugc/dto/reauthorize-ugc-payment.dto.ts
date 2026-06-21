import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReauthorizeUgcPaymentDto {
  @ApiProperty({
    description:
      "ID du moyen de paiement Stripe pour ré-autoriser le paiement (autorisation initiale expirée)",
    example: 'pm_1234567890abcdef',
  })
  @IsNotEmpty()
  @IsString()
  paymentMethodId: string;
}
