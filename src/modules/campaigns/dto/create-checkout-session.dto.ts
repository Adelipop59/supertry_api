import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'URL de redirection en cas de succès', example: 'https://super-try.com/campaigns/success' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^https?:\/\/.+/, {
    message: 'successUrl must be a valid URL starting with http:// or https://',
  })
  successUrl: string;

  @ApiProperty({ description: 'URL de redirection en cas d\'annulation', example: 'https://super-try.com/campaigns/cancel' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^https?:\/\/.+/, {
    message: 'cancelUrl must be a valid URL starting with http:// or https://',
  })
  cancelUrl: string;
}
