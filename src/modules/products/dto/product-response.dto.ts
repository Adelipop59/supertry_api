import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SellerSummaryDto {
  @ApiProperty({ description: 'ID du vendeur', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'Prénom du vendeur', example: 'Jean' })
  firstName: string;

  @ApiProperty({ description: 'Nom du vendeur', example: 'Dupont' })
  lastName: string;

  @ApiPropertyOptional({ description: 'Nom de la société du vendeur', example: 'SuperTech SARL' })
  companyName?: string;

  @ApiPropertyOptional({ description: 'URL de l\'avatar du vendeur', example: 'https://example.com/avatar.jpg' })
  avatar?: string;
}

class CategorySummaryDto {
  @ApiProperty({ description: 'ID de la catégorie', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'Nom de la catégorie', example: 'Smartphones' })
  name: string;

  @ApiProperty({ description: 'Slug de la catégorie', example: 'smartphones' })
  slug: string;
}

export class ProductResponseDto {
  @ApiProperty({ description: 'ID unique du produit', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'ID du vendeur', example: '550e8400-e29b-41d4-a716-446655440000' })
  sellerId: string;

  @ApiProperty({ description: 'Informations du vendeur', type: () => SellerSummaryDto })
  seller: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    avatar?: string;
  };

  @ApiProperty({ description: 'ID de la catégorie', example: '550e8400-e29b-41d4-a716-446655440000' })
  categoryId: string;

  @ApiProperty({ description: 'Informations de la catégorie', type: () => CategorySummaryDto })
  category: {
    id: string;
    name: string;
    slug: string;
  };

  @ApiProperty({ description: 'Nom du produit', example: 'Samsung Galaxy S24 Ultra' })
  name: string;

  @ApiProperty({ description: 'Description du produit', example: 'Smartphone haut de gamme avec stylet S-Pen intégré' })
  description: string;

  @ApiPropertyOptional({ description: 'ASIN Amazon du produit', example: 'B0CSD7H7K3' })
  asin?: string;

  @ApiPropertyOptional({ description: 'URL du produit sur la marketplace', example: 'https://www.amazon.fr/dp/B0CSD7H7K3' })
  productUrl?: string;

  @ApiProperty({ description: 'Prix du produit en euros', example: 29.99 })
  price: number;

  @ApiProperty({ description: 'Frais de livraison en euros', example: 4.99 })
  shippingCost: number;

  @ApiProperty({ description: 'URLs des images du produit', example: ['https://example.com/image1.jpg'] })
  images: string[];

  @ApiProperty({ description: 'Indique si le produit est actif', example: true })
  isActive: boolean;

  @ApiProperty({ description: 'Date de création du produit', example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de dernière mise à jour du produit', example: '2024-01-15T10:30:00.000Z' })
  updatedAt: Date;
}
