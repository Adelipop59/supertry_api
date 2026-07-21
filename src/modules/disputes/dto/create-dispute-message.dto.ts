import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeVisibility } from '@prisma/client';

export class CreateDisputeMessageDto {
  @ApiProperty({
    description: 'Contenu du message de litige',
    example: 'Bonjour, voici les preuves demandées.',
    minLength: 1,
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({
    description:
      'Visibilité du message (ADMIN uniquement). Ignoré et forcé à BOTH pour USER et PRO.',
    enum: DisputeVisibility,
    default: DisputeVisibility.BOTH,
  })
  @IsOptional()
  @IsEnum(DisputeVisibility)
  visibility?: DisputeVisibility;

  @ApiPropertyOptional({ description: 'Pièces jointes (JSON)' })
  @IsOptional()
  attachments?: any;
}
