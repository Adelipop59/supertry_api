import { IsNotEmpty, IsString, IsEnum, IsOptional, IsNumber, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export enum UgcDisputeResolutionType {
  PAY_TESTER = 'pay_tester',
  REJECT_UGC = 'reject_ugc',
  PARTIAL_PAYMENT = 'partial_payment',
}

export class ResolveUgcDisputeDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  disputeResolution: string;

  @IsNotEmpty()
  @IsEnum(UgcDisputeResolutionType)
  resolutionType: UgcDisputeResolutionType;

  /** Montant partiel à payer au testeur (uniquement pour PARTIAL_PAYMENT) */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  partialAmount?: number;
}
