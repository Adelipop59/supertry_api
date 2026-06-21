import { IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWithdrawalDto {
  @ApiProperty({
    description: 'Montant du retrait en euros (minimum 10, maximum 10000, 2 décimales max)',
    example: 50.0,
    minimum: 10,
    maximum: 10000,
  })
  // maxDecimalPlaces: 2 → évite les montants type 10.999 incohérents avec le wallet Decimal(10,2)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(10)
  @Max(10000)
  amount: number;
}
