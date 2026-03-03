import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TranslationService } from './translation.service';
import { IsString, IsOptional, IsIn } from 'class-validator';

class TranslateDto {
  @IsString()
  text: string;

  @IsString()
  @IsIn(['fr', 'en', 'es', 'de', 'it', 'pt'])
  targetLang: string;

  @IsOptional()
  @IsString()
  @IsIn(['fr', 'en', 'es', 'de', 'it', 'pt', 'auto'])
  sourceLang?: string;
}

class TranslateBatchDto {
  @IsString({ each: true })
  texts: string[];

  @IsString()
  @IsIn(['fr', 'en', 'es', 'de', 'it', 'pt'])
  targetLang: string;

  @IsOptional()
  @IsString()
  @IsIn(['fr', 'en', 'es', 'de', 'it', 'pt', 'auto'])
  sourceLang?: string;
}

@ApiTags('Translation')
@Controller('translate')
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

  @Post()
  @ApiOperation({ summary: 'Translate text to target language' })
  async translate(@Body() dto: TranslateDto) {
    return this.translationService.translate(dto.text, dto.targetLang, dto.sourceLang);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Translate multiple texts to target language' })
  async translateBatch(@Body() dto: TranslateBatchDto) {
    const translatedTexts = await this.translationService.translateBatch(
      dto.texts,
      dto.targetLang,
      dto.sourceLang,
    );
    return { translatedTexts };
  }

  @Get('status')
  @ApiOperation({ summary: 'Check if translation service is available' })
  async status() {
    const available = await this.translationService.isAvailable();
    return { available };
  }
}
