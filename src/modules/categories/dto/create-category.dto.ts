import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Nom de la catégorie', example: 'Électronique' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Slug unique de la catégorie', example: 'electronique' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  slug: string;

  @ApiPropertyOptional({ description: 'Description de la catégorie', example: 'Produits électroniques et high-tech' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Icône de la catégorie', example: 'laptop' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string;
}
