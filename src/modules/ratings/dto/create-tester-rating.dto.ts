import { IsNotEmpty, IsUUID, IsInt, Min, Max, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTesterRatingDto {
  @ApiProperty({
    description: 'ID de la session liée à la notation du testeur',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  sessionId: string;

  @ApiProperty({
    description: 'Note attribuée au testeur (1 à 5)',
    example: 4,
    minimum: 1,
    maximum: 5,
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    description: 'Commentaire sur le testeur',
    example: 'Excellent testeur, très professionnel',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
