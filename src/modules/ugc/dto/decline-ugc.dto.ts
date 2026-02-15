import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclineUgcDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declineReason?: string;
}
