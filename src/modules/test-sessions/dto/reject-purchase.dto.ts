import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectPurchaseDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  purchaseRejectionReason: string;
}
