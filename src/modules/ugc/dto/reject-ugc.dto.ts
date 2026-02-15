import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectUgcDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  rejectionReason: string;
}
