import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelUgcDto {
  @ApiPropertyOptional({
    description: "Raison de l'annulation de la demande UGC par le vendeur",
    example: 'Le produit n\'est plus disponible',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cancellationReason?: string;
}
