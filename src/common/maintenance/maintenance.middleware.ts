import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { I18nContext, I18nService } from 'nestjs-i18n';
import type { NextFunction, Request, Response } from 'express';
import { LuciaService } from '../../modules/lucia/lucia.service';
import { PrismaService } from '../../database/prisma.service';
import { isMaintenanceMode, isOpenDuringMaintenance } from './maintenance';

/**
 * Bloque toute l'API pour les non-admins quand MAINTENANCE_MODE=true.
 *
 * Tourne avant les guards : le rôle est lu en base à partir de la session
 * (cookie auth_session ou Bearer), jamais depuis une donnée fournie par le client.
 */
@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  constructor(
    private readonly luciaService: LuciaService,
    private readonly prismaService: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (!isMaintenanceMode()) return next();
    if (req.method === 'OPTIONS') return next();
    if (isOpenDuringMaintenance(req.originalUrl)) return next();

    if (await this.isAdminRequest(req)) return next();

    const lang = I18nContext.current()?.lang ?? this.pickLang(req);
    res.setHeader('Retry-After', '3600');
    res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      errorCode: 'MAINTENANCE',
      message: this.i18n.t('common.maintenance', { lang }),
    });
  }

  private async isAdminRequest(req: Request): Promise<boolean> {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const cookies = req.cookies as Record<string, string> | undefined;
    const sessionId = cookies?.['auth_session'] || bearer;
    if (!sessionId) return false;

    try {
      const { user } = await this.luciaService.validateSession(sessionId);
      if (!user) return false;
      const profile = await this.prismaService.profile.findUnique({
        where: { id: user.id },
        select: { role: true, isActive: true },
      });
      return profile?.role === 'ADMIN' && profile.isActive;
    } catch {
      return false;
    }
  }

  private pickLang(req: Request): string {
    const header =
      (req.headers['x-lang'] as string) || req.headers['accept-language'] || '';
    return header.split(',')[0].split('-')[0].trim().toLowerCase() || 'fr';
  }
}
