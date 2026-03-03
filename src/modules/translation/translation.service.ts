import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TranslateResponse {
  translatedText: string;
  detectedLanguage?: { confidence: number; language: string };
}

interface DetectResponse {
  confidence: number;
  language: string;
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly baseUrl: string;
  private readonly cache = new Map<string, { text: string; expiry: number }>();
  private readonly cacheTtlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('LIBRETRANSLATE_URL', 'http://localhost:5000');
  }

  /**
   * Translate text from one language to another.
   * Results are cached in memory for 24 hours.
   */
  async translate(
    text: string,
    targetLang: string,
    sourceLang?: string,
  ): Promise<{ translatedText: string; detectedSourceLang: string }> {
    if (!text || text.trim().length === 0) {
      return { translatedText: text, detectedSourceLang: sourceLang || 'auto' };
    }

    const source = sourceLang || 'auto';

    // Check cache
    const cacheKey = `${source}:${targetLang}:${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return { translatedText: cached.text, detectedSourceLang: source };
    }

    try {
      const response = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source,
          target: targetLang,
          format: 'text',
        }),
      });

      if (!response.ok) {
        this.logger.warn(`LibreTranslate error: ${response.status} ${response.statusText}`);
        return { translatedText: text, detectedSourceLang: source };
      }

      const data = (await response.json()) as TranslateResponse;

      // Cache the result
      this.cache.set(cacheKey, {
        text: data.translatedText,
        expiry: Date.now() + this.cacheTtlMs,
      });

      // Clean old cache entries periodically
      if (this.cache.size > 10000) {
        this.cleanCache();
      }

      return {
        translatedText: data.translatedText,
        detectedSourceLang: data.detectedLanguage?.language || source,
      };
    } catch (error) {
      this.logger.warn(
        `LibreTranslate unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { translatedText: text, detectedSourceLang: source };
    }
  }

  /**
   * Translate multiple texts at once.
   */
  async translateBatch(
    texts: string[],
    targetLang: string,
    sourceLang?: string,
  ): Promise<string[]> {
    const results = await Promise.all(
      texts.map((text) => this.translate(text, targetLang, sourceLang)),
    );
    return results.map((r) => r.translatedText);
  }

  /**
   * Detect the language of a text.
   */
  async detectLanguage(text: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text }),
      });

      if (!response.ok) {
        return 'auto';
      }

      const data = (await response.json()) as DetectResponse[];
      return data[0]?.language || 'auto';
    } catch {
      return 'auto';
    }
  }

  /**
   * Check if LibreTranslate is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/languages`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  private cleanCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiry < now) {
        this.cache.delete(key);
      }
    }
  }
}
