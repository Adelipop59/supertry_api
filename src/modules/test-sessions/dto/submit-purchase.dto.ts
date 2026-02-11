import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsUrl,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitPurchaseDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  orderNumber: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  productPrice: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost: number;

  @IsNotEmpty()
  @IsUrl()
  purchaseProofUrl: string;
}
