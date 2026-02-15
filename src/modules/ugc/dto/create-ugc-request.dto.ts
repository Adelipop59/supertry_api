import {
  IsNotEmpty,
  IsEnum,
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { UGCType } from '@prisma/client';

export class CreateUgcRequestDto {
  @IsNotEmpty()
  @IsUUID()
  sessionId: string;

  @IsNotEmpty()
  @IsEnum(UGCType)
  type: UGCType;

  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  /** Requis pour VIDEO/PHOTO (UGC payant) */
  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
