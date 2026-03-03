import { Injectable, ExecutionContext } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';
import { Request } from 'express';

/**
 * Custom i18n language resolver.
 * Resolution order:
 * 1. x-lang header (explicit override from frontend)
 * 2. Accept-Language header (handled by AcceptLanguageResolver in the chain)
 * 3. User's preferredLanguage from profile (if authenticated)
 * 4. Fallback: 'fr' (configured in I18nModule)
 */
@Injectable()
export class UserLanguageResolver implements I18nResolver {
  resolve(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request) return undefined;

    // 1. Explicit x-lang header takes priority
    const xLang = request.headers['x-lang'];
    if (xLang && typeof xLang === 'string') {
      const lang = xLang.toLowerCase().substring(0, 2);
      if (['fr', 'en', 'es', 'de', 'it', 'pt'].includes(lang)) {
        return lang;
      }
    }

    // 2. User's profile preferred language (set by auth guard on request)
    const user = (request as any).user;
    if (user?.preferredLanguage) {
      return user.preferredLanguage.toLowerCase();
    }

    // 3. Let the next resolver in the chain handle it (AcceptLanguageResolver)
    return undefined;
  }
}
