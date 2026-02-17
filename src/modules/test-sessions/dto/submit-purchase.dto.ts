import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsUrl,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitPurchaseDto {
  @ApiProperty({
    description: 'Numéro de commande sur la marketplace',
    example: 'AMZ-123-456-789',
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  orderNumber: string;

  @ApiProperty({
    description: 'Prix du produit acheté (en euros)',
    example: 29.99,
    minimum: 0,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  productPrice: number;

  @ApiProperty({
    description: 'Frais de livraison (en euros)',
    example: 4.99,
    minimum: 0,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost: number;

  @ApiProperty({
    description: 'URL de la preuve d\'achat (capture d\'écran ou photo)',
    example: 'https://example.com/proof.jpg',
  })
  @IsNotEmpty()
  @IsUrl()
  purchaseProofUrl: string;
}
