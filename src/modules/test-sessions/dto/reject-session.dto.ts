import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectSessionDto {
  @ApiProperty({
    description: 'Raison du rejet de la candidature du testeur',
    example: 'Profil ne correspondant pas aux critères de la campagne',
    maxLength: 1000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  rejectionReason: string;
}
