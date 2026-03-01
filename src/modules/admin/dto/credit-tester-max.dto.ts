import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreditTesterMaxDto {
  @ApiPropertyOptional({
    description: 'Raison du crédit au montant maximum',
    example: 'Le testeur a payé moins que le max, on lui accorde le montant maximum',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
