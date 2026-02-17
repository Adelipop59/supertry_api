import {
  IsOptional,
  IsNumber,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ValidatePurchaseDto {
  @ApiPropertyOptional({
    description: 'Prix du produit corrigé par le vendeur (en euros)',
    example: 29.99,
    minimum: 0,
  })
  // Optional: PRO can override the productPrice if tester made a mistake
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  productPrice?: number;

  @ApiPropertyOptional({
    description: 'Frais de livraison corrigés par le vendeur (en euros)',
    example: 4.99,
    minimum: 0,
  })
  // Optional: PRO can override the shippingCost if tester made a mistake
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional({
    description: 'Commentaire de validation de l\'achat par le vendeur',
    example: 'Achat validé, les montants sont corrects',
    maxLength: 500,
  })
  // Optional: PRO can add a validation comment
  @IsOptional()
  @IsString()
  @MaxLength(500)
  purchaseValidationComment?: string;
}
