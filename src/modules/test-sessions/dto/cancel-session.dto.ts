import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelSessionDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  cancellationReason: string;
}
