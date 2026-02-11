import { IsNotEmpty, IsString, MaxLength, IsEnum, IsOptional, IsNumber, Min } from 'class-validator';

export enum DisputeResolutionType {
  REFUND_TESTER = 'refund_tester',
  REFUND_PRO = 'refund_pro',
  NO_REFUND = 'no_refund',
  PARTIAL_REFUND = 'partial_refund',
}

export class ResolveDisputeDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  disputeResolution: string;

  @IsNotEmpty()
  @IsEnum(DisputeResolutionType)
  resolutionType: DisputeResolutionType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  refundAmount?: number;
}
