import {
  IsNotEmpty,
  IsEnum,
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UGCType } from '@prisma/client';

export class CreateUgcRequestDto {
  @ApiProperty({
    description: 'ID de la session liée à la demande UGC',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  sessionId: string;

  @ApiProperty({
    description: 'Type de contenu UGC demandé',
    enum: ['VIDEO', 'PHOTO', 'TEXT_REVIEW', 'EXTERNAL_REVIEW'],
    example: 'VIDEO',
  })
  @IsNotEmpty()
  @IsEnum(UGCType)
  type: UGCType;

  @ApiProperty({
    description: 'Description détaillée de la demande UGC',
    example: 'Veuillez filmer un unboxing du produit avec votre avis sincère',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({
    description: 'Date limite de soumission du UGC (format ISO 8601)',
    example: '2026-03-15T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({
    description: 'ID du moyen de paiement Stripe (requis pour VIDEO/PHOTO)',
    example: 'pm_1234567890abcdef',
  })
  /** Requis pour VIDEO/PHOTO (UGC payant) */
  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
