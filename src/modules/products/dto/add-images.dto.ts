import { IsArray, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddImagesDto {
  @ApiProperty({
    description: 'URLs des images à ajouter',
    example: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
  })
  @IsNotEmpty()
  @IsArray()
  @IsUrl({}, { each: true })
  images: string[];
}
