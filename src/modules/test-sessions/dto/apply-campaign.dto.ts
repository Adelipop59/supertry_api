import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyToCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  applicationMessage?: string;
}
