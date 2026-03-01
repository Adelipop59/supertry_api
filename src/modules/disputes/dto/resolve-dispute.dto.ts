import { IsNotEmpty, IsString, MaxLength, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveDisputeDto {
  @ApiProperty({
    description: 'Note de résolution du litige',
    example: 'Le testeur a fourni les preuves de test demandées',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  disputeResolution: string;

  @ApiProperty({
    description: 'Montant accordé au testeur (entre 0 et le montant max de la campagne). Le reste est automatiquement remboursé au PRO.',
    example: 25.00,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  testerAmount: number;
}
