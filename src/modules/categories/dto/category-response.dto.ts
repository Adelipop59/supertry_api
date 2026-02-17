import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ description: 'Identifiant unique de la catégorie', example: 'clx1234567890' })
  id: string;

  @ApiProperty({ description: 'Nom de la catégorie', example: 'Électronique' })
  name: string;

  @ApiProperty({ description: 'Slug unique de la catégorie', example: 'electronique' })
  slug: string;

  @ApiPropertyOptional({ description: 'Description de la catégorie', example: 'Produits électroniques et high-tech' })
  description?: string;

  @ApiPropertyOptional({ description: 'Icône de la catégorie', example: 'laptop' })
  icon?: string;

  @ApiProperty({ description: 'Indique si la catégorie est active', example: true })
  isActive: boolean;

  @ApiProperty({ description: 'Date de création', example: '2025-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de dernière modification', example: '2025-01-01T00:00:00.000Z' })
  updatedAt: Date;
}
