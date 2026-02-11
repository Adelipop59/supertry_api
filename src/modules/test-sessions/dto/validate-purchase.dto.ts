import {
  IsOptional,
  IsNumber,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ValidatePurchaseDto {
  // Optional: PRO can override the productPrice if tester made a mistake
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  productPrice?: number;

  // Optional: PRO can override the shippingCost if tester made a mistake
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  // Optional: PRO can add a validation comment
  @IsOptional()
  @IsString()
  @MaxLength(500)
  purchaseValidationComment?: string;
}
