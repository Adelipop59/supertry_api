import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  MaxLength,
  Min,
  IsArray,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({
    description: 'Nom du produit',
    example: 'Samsung Galaxy S24 Ultra',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'Description du produit',
    example: 'Smartphone haut de gamme avec stylet S-Pen intégré',
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({
    description: 'ID de la catégorie du produit',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({
    description: 'ASIN Amazon du produit',
    example: 'B0CSD7H7K3',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  asin?: string;

  @ApiPropertyOptional({
    description: 'URL du produit sur la marketplace',
    example: 'https://www.amazon.fr/dp/B0CSD7H7K3',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  productUrl?: string;

  @ApiProperty({
    description: 'Prix du produit en euros',
    example: 29.99,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    description: 'Frais de livraison en euros',
    example: 4.99,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost: number;

  @ApiPropertyOptional({
    description: 'URLs des images du produit',
    example: ['https://example.com/image1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
