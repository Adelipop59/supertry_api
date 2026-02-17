import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectUgcDto {
  @ApiProperty({
    description: 'Raison du rejet du UGC',
    example: 'La qualité de la vidéo est insuffisante',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  rejectionReason: string;
}
