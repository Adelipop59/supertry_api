import { IsArray, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveImagesDto {
  @ApiProperty({
    description: 'URLs des images à supprimer',
    example: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
  })
  @IsNotEmpty()
  @IsArray()
  @IsUrl({}, { each: true })
  images: string[];
}
