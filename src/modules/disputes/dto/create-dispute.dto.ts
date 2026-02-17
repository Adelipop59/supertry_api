import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDisputeDto {
  @ApiProperty({
    description: 'Raison du litige',
    example: 'Le testeur n\'a pas respecté les consignes de test',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  disputeReason: string;
}
