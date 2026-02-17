import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsNumber,
  IsBoolean,
  IsOptional,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOfferDto {
  @ApiProperty({ description: 'ID du produit', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Nom du produit', example: 'Samsung Galaxy S24 Ultra' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  productName: string;

  @ApiProperty({ description: 'Prix attendu', example: 29.99 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedPrice: number;

  @ApiProperty({ description: 'Frais de livraison', example: 4.99 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost: number;

  @ApiProperty({ description: 'Prix minimum de la fourchette', example: 25.00 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceRangeMin: number;

  @ApiProperty({ description: 'Prix maximum de la fourchette', example: 35.00 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceRangeMax: number;

  @ApiProperty({ description: 'Prix révélé au testeur', example: true })
  @IsNotEmpty()
  @IsBoolean()
  isPriceRevealed: boolean;

  @ApiProperty({ description: 'Prix remboursé', example: true })
  @IsNotEmpty()
  @IsBoolean()
  reimbursedPrice: boolean;

  @ApiProperty({ description: 'Livraison remboursée', example: true })
  @IsNotEmpty()
  @IsBoolean()
  reimbursedShipping: boolean;

  @ApiPropertyOptional({ description: 'Prix maximum remboursé', example: 35.00 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxReimbursedPrice?: number;

  @ApiPropertyOptional({ description: 'Frais de livraison maximum remboursés', example: 5.00 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxReimbursedShipping?: number;

  @ApiProperty({ description: 'Bonus pour le testeur', example: 5.00 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(5) // Minimum 5€ bonus obligatoire
  bonus: number;

  @ApiProperty({ description: 'Quantité', example: 1 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  quantity: number;
}
