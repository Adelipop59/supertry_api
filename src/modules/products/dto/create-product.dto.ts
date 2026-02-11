import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  MaxLength,
  Min,
  IsArray,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNotEmpty()
  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  asin?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  productUrl?: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
