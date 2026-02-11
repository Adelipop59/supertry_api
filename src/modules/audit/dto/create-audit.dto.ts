import { IsEnum, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { AuditCategory } from '@prisma/client';

export class CreateAuditDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsNotEmpty()
  @IsEnum(AuditCategory)
  category: AuditCategory;

  @IsNotEmpty()
  @IsString()
  action: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, any>;
}
