import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsArray,
  ArrayMinSize,
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
    description: 'Clés S3 des preuves d\'achat (images ou documents uploadés via /test-sessions/:id/upload-purchase-proof)',
    example: ['purchases/session-id/screenshot.png', 'purchases/session-id/facture.pdf'],
    type: [String],
  })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  purchaseProofKeys: string[];
}
