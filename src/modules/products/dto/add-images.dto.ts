import { IsArray, IsNotEmpty, IsUrl } from 'class-validator';

export class AddImagesDto {
  @IsNotEmpty()
  @IsArray()
  @IsUrl({}, { each: true })
  images: string[];
}
