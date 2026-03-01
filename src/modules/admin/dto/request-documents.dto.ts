import { IsArray, IsNotEmpty, IsString, MaxLength, ArrayMinSize, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestDocumentsDto {
  @ApiProperty({
    description: 'Types de documents demandés',
    example: ['purchase_proof', 'delivery_confirmation', 'product_photo'],
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  documentTypes: string[];

  @ApiProperty({
    description: 'Message à destination de la partie concernée',
    example: 'Merci de fournir une preuve de livraison du produit',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  message: string;

  @ApiProperty({
    description: 'Cible de la demande de documents',
    example: 'tester',
    enum: ['tester', 'pro'],
  })
  @IsNotEmpty()
  @IsIn(['tester', 'pro'])
  target: 'tester' | 'pro';
}
