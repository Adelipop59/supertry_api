import { IsString } from 'class-validator';

export class ProcessCampaignPaymentDto {
  @IsString()
  paymentMethodId: string;
}
