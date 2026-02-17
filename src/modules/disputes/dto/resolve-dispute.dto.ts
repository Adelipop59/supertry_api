import { IsNotEmpty, IsString, MaxLength, IsEnum, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DisputeResolutionType {
  REFUND_TESTER = 'refund_tester',
  REFUND_PRO = 'refund_pro',
  NO_REFUND = 'no_refund',
  PARTIAL_REFUND = 'partial_refund',
}

export class ResolveDisputeDto {
  @ApiProperty({
    description: 'Note de résolution du litige',
    example: 'Le testeur a fourni les preuves de test demandées',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  disputeResolution: string;

  @ApiProperty({
    description: 'Type de résolution du litige',
    enum: DisputeResolutionType,
    example: DisputeResolutionType.REFUND_TESTER,
  })
  @IsNotEmpty()
  @IsEnum(DisputeResolutionType)
  resolutionType: DisputeResolutionType;

  @ApiPropertyOptional({
    description: 'Montant du remboursement (requis pour les remboursements partiels)',
    example: 15.99,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  refundAmount?: number;
}
