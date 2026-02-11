import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateDisputeDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  disputeReason: string;
}
