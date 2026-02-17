import { IsNotEmpty, IsUUID, IsInt, Min, Max, IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty({
    description: 'ID de la session liée à l\'avis',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  sessionId: string;

  @ApiProperty({
    description: 'Note du produit (1 à 5)',
    example: 4,
    minimum: 1,
    maximum: 5,
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  productRating: number;

  @ApiProperty({
    description: 'Note du vendeur (1 à 5)',
    example: 5,
    minimum: 1,
    maximum: 5,
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  sellerRating: number;

  @ApiPropertyOptional({
    description: 'Commentaire accompagnant l\'avis',
    example: 'Excellent produit, livraison rapide et vendeur très réactif',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({
    description: 'Indique si l\'avis est visible publiquement',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
