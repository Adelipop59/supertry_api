import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ValidatePriceDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  productPrice: number;
}
