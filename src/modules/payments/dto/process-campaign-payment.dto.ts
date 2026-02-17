import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProcessCampaignPaymentDto {
  @ApiProperty({
    description: 'Identifiant du moyen de paiement Stripe',
    example: 'pm_1234567890',
  })
  @IsString()
  paymentMethodId: string;
}
