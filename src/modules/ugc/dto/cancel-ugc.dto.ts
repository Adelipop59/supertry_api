import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelUgcDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cancellationReason?: string;
}
