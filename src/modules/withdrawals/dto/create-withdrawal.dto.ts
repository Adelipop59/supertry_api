import { IsNumber, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(10)
  amount: number;
}
