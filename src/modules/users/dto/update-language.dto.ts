import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Language } from '@prisma/client';

export class UpdateLanguageDto {
  @ApiProperty({ enum: Language, example: 'FR', description: 'Preferred language code' })
  @IsEnum(Language)
  language: Language;
}
