import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWithdrawalDto {
  @ApiProperty({
    description: 'Montant du retrait en euros (minimum 10)',
    example: 50.00,
    minimum: 10,
  })
  @IsNumber()
  @Min(10)
  amount: number;
}
