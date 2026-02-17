import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OfferResponseDto {
  @ApiProperty({ description: 'ID de l\'offre', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'ID de la campagne', example: '550e8400-e29b-41d4-a716-446655440001' })
  campaignId: string;

  @ApiProperty({ description: 'ID du produit', example: '550e8400-e29b-41d4-a716-446655440002' })
  productId: string;

  @ApiProperty({ description: 'Nom du produit', example: 'Samsung Galaxy S24 Ultra' })
  productName: string;

  @ApiProperty({ description: 'Prix attendu', example: 29.99 })
  expectedPrice: number;

  @ApiProperty({ description: 'Frais de livraison', example: 4.99 })
  shippingCost: number;

  @ApiProperty({ description: 'Prix minimum de la fourchette', example: 25.00 })
  priceRangeMin: number;

  @ApiProperty({ description: 'Prix maximum de la fourchette', example: 35.00 })
  priceRangeMax: number;

  @ApiProperty({ description: 'Prix révélé au testeur', example: true })
  isPriceRevealed: boolean;

  @ApiProperty({ description: 'Prix remboursé', example: true })
  reimbursedPrice: boolean;

  @ApiProperty({ description: 'Livraison remboursée', example: true })
  reimbursedShipping: boolean;

  @ApiPropertyOptional({ description: 'Prix maximum remboursé', example: 35.00 })
  maxReimbursedPrice?: number;

  @ApiPropertyOptional({ description: 'Frais de livraison maximum remboursés', example: 5.00 })
  maxReimbursedShipping?: number;

  @ApiProperty({ description: 'Bonus pour le testeur', example: 5.00 })
  bonus: number;

  @ApiProperty({ description: 'Quantité', example: 1 })
  quantity: number;

  @ApiProperty({ description: 'Date de création', example: '2026-02-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Date de mise à jour', example: '2026-02-16T14:00:00.000Z' })
  updatedAt: Date;
}
