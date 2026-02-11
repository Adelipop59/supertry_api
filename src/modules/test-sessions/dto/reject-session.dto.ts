import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectSessionDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  rejectionReason: string;
}
