import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsNumber,
  IsBoolean,
  IsOptional,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOfferDto {
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  productName: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedPrice: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceRangeMin: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceRangeMax: number;

  @IsNotEmpty()
  @IsBoolean()
  isPriceRevealed: boolean;

  @IsNotEmpty()
  @IsBoolean()
  reimbursedPrice: boolean;

  @IsNotEmpty()
  @IsBoolean()
  reimbursedShipping: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxReimbursedPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxReimbursedShipping?: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(5) // Minimum 5€ bonus obligatoire
  bonus: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  quantity: number;
}
