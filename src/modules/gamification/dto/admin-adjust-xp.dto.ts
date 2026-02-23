import { IsInt, IsString, IsUUID, MinLength } from 'class-validator';

export class AdminAdjustXpDto {
  @IsUUID()
  testerId: string;

  @IsInt()
  amount: number;

  @IsString()
  @MinLength(5)
  reason: string;
}
