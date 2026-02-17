import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ValidatePriceDto {
  @ApiProperty({
    description: 'Prix du produit validé par le testeur (en euros)',
    example: 29.99,
    minimum: 0,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  productPrice: number;
}
