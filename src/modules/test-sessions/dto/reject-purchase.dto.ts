import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectPurchaseDto {
  @ApiProperty({
    description: 'Raison du rejet de la preuve d\'achat soumise par le testeur',
    example: 'La preuve d\'achat ne correspond pas au produit de la campagne',
    maxLength: 1000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  purchaseRejectionReason: string;
}
