import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditCategory } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { AUDIT_METADATA_KEY } from '../decorators/audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;

    // Skip logging pour les endpoints d'audit (éviter boucle infinie)
    if (url.startsWith('/audit') || url.startsWith('/api/v1/audit')) {
      return next.handle();
    }

    // Extraire userId du contexte (JWT, session, etc.)
    // TODO: Adapter selon votre système d'auth (Lucia, JWT, etc.)
    const userId = request.user?.id || request.session?.userId || null;

    // Déterminer la catégorie depuis l'URL
    const category = this.determineCategoryFromUrl(url);

    // Vérifier si un décorateur @Audit est appliqué
    const auditMetadata = this.reflector.get<{
      category?: AuditCategory;
      action?: string;
    }>(AUDIT_METADATA_KEY, context.getHandler());

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          // Logging en mode fire-and-forget (ne bloque pas la réponse)
          const action = auditMetadata?.action || this.generateAction(method, url);
          const finalCategory = auditMetadata?.category || category;

          this.auditService
            .log(userId, finalCategory, action, {
              method,
              url,
              statusCode: context.switchToHttp().getResponse().statusCode,
            })
            .catch((error) => {
              this.logger.error(`Failed to log audit: ${error.message}`);
            });
        },
        error: (error) => {
          // Logger aussi les erreurs
          const action = `${method}_ERROR`;
          this.auditService
            .log(userId, category, action, {
              method,
              url,
              error: error.message,
            })
            .catch((err) => {
              this.logger.error(`Failed to log audit error: ${err.message}`);
            });
        },
      }),
    );
  }

  /**
   * Détermine la catégorie d'audit depuis l'URL
   */
  private determineCategoryFromUrl(url: string): AuditCategory {
    if (url.includes('/auth/')) return AuditCategory.AUTH;
    if (url.includes('/user')) return AuditCategory.USER;
    if (url.includes('/admin')) return AuditCategory.ADMIN;
    if (url.includes('/product')) return AuditCategory.PRODUCT;
    if (url.includes('/campaign')) return AuditCategory.CAMPAIGN;
    if (url.includes('/session')) return AuditCategory.SESSION;
    if (url.includes('/wallet')) return AuditCategory.WALLET;
    if (url.includes('/message')) return AuditCategory.MESSAGE;
    if (url.includes('/system')) return AuditCategory.SYSTEM;
    return AuditCategory.OTHER;
  }

  /**
   * Génère un nom d'action depuis la méthode HTTP et l'URL
   */
  private generateAction(method: string, url: string): string {
    const pathParts = url.split('/').filter((p) => p && !p.match(/^[0-9a-f-]{36}$/i));
    const resource = pathParts[pathParts.length - 1] || 'UNKNOWN';
    return `${method.toUpperCase()}_${resource.toUpperCase()}`;
  }
}
