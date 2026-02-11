import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^https?:\/\/.+/, {
    message: 'successUrl must be a valid URL starting with http:// or https://',
  })
  successUrl: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^https?:\/\/.+/, {
    message: 'cancelUrl must be a valid URL starting with http:// or https://',
  })
  cancelUrl: string;
}
