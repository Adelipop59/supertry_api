import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DeclineUgcDto {
  @ApiPropertyOptional({
    description: 'Raison pour laquelle le testeur décline la demande UGC',
    example: 'Je ne dispose pas du matériel nécessaire pour ce type de contenu',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declineReason?: string;
}
