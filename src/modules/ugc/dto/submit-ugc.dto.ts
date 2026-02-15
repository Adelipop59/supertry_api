import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitUgcDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  /** Pour TEXT_REVIEW (texte) ou EXTERNAL_REVIEW (URL). Pour VIDEO/PHOTO, utiliser le file upload multipart. */
  @IsOptional()
  @IsString()
  contentUrl?: string;
}
