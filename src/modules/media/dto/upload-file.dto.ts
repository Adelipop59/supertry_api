import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { MediaFolder, MediaType } from '../media.service';

export class UploadFileDto {
  @IsEnum(MediaFolder)
  folder: MediaFolder;

  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsOptional()
  @IsString()
  subfolder?: string;

  @IsOptional()
  @IsString()
  customFilename?: string;

  @IsOptional()
  @IsBoolean()
  makePublic?: boolean;
}
