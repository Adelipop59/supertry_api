import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelSessionDto {
  @ApiProperty({
    description: 'Raison de l\'annulation de la session de test',
    example: 'Produit non conforme à la description',
    maxLength: 1000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  cancellationReason: string;
}
