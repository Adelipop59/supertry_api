import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { NextFunction, Request, Response } from 'express';
import {
  MAINTENANCE_COOKIE,
  MAINTENANCE_HEADER,
  isMaintenanceMode,
  isOpenDuringMaintenance,
  verifyMaintenancePass,
} from './maintenance';

/**
 * Ferme toute l'API quand MAINTENANCE_MODE=true : chaque requête doit porter
 * un pass valide (cookie mt_pass ou en-tête x-maintenance-pass), obtenu sur le
 * site avec le code d'accès. Tourne avant les guards et les contrôleurs.
 */
@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  constructor(private readonly i18n: I18nService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (!isMaintenanceMode()) return next();
    if (req.method === 'OPTIONS') return next();
    if (isOpenDuringMaintenance(req.originalUrl)) return next();

    const cookies = req.cookies as Record<string, string> | undefined;
    const header = req.headers[MAINTENANCE_HEADER];
    const pass =
      (typeof header === 'string' ? header : undefined) ??
      cookies?.[MAINTENANCE_COOKIE];
    if (verifyMaintenancePass(pass)) return next();

    res.setHeader('Retry-After', '3600');
    res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      errorCode: 'MAINTENANCE',
      message: this.i18n.t('common.maintenance', { lang: this.pickLang(req) }),
    });
  }

  private pickLang(req: Request): string {
    const header =
      (req.headers['x-lang'] as string) || req.headers['accept-language'] || '';
    return header.split(',')[0].split('-')[0].trim().toLowerCase() || 'fr';
  }
}
