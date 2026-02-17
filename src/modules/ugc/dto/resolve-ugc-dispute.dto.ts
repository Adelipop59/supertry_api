import { IsNotEmpty, IsString, IsEnum, IsOptional, IsNumber, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum UgcDisputeResolutionType {
  PAY_TESTER = 'pay_tester',
  REJECT_UGC = 'reject_ugc',
  PARTIAL_PAYMENT = 'partial_payment',
}

export class ResolveUgcDisputeDto {
  @ApiProperty({
    description: 'Explication de la résolution du litige par l\'admin',
    example: 'Le contenu est partiellement conforme, paiement partiel accordé',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  disputeResolution: string;

  @ApiProperty({
    description: 'Type de résolution du litige',
    enum: UgcDisputeResolutionType,
    example: 'partial_payment',
  })
  @IsNotEmpty()
  @IsEnum(UgcDisputeResolutionType)
  resolutionType: UgcDisputeResolutionType;

  @ApiPropertyOptional({
    description: 'Montant partiel à payer au testeur (uniquement pour PARTIAL_PAYMENT)',
    example: 15.5,
    minimum: 0,
  })
  /** Montant partiel à payer au testeur (uniquement pour PARTIAL_PAYMENT) */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  partialAmount?: number;
}
