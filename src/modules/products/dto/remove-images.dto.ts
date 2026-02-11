import { IsArray, IsNotEmpty, IsUrl } from 'class-validator';

export class RemoveImagesDto {
  @IsNotEmpty()
  @IsArray()
  @IsUrl({}, { each: true })
  images: string[];
}
