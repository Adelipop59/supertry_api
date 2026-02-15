import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ValidateUgcDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  validationComment?: string;
}
