import { IsNotEmpty, IsString, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class CancelCampaignDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  cancellationReason: string;

  @IsOptional()
  @IsBoolean()
  forceCancel?: boolean; // Pour ADMIN uniquement
}
