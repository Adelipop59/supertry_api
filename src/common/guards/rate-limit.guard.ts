import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

/**
 * Rate-limiting léger, sans dépendance externe (SEC-E4).
 *
 * - En mémoire (par instance) : suffisant pour freiner le brute-force ; pour un
 *   déploiement multi-réplicas, migrer vers un store Redis partagé.
 * - FAIL-OPEN : toute erreur interne laisse passer la requête → ne peut jamais
 *   bloquer un login légitime à cause d'un bug du guard. Seule la 429 volontaire
 *   (quota dépassé) interrompt la requête.
 * - Scopé : ne s'applique QU'AUX routes annotées avec @RateLimit().
 */
export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export const RateLimit = (limit: number, windowSeconds: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSeconds } as RateLimitOptions);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    try {
      const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
        RATE_LIMIT_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!opts) return true; // pas de limite définie → laisser passer

      const req = context.switchToHttp().getRequest<Request>();
      const fwd = req.headers['x-forwarded-for'];
      const ip =
        (typeof fwd === 'string' ? fwd.split(',')[0].trim() : undefined) ||
        req.ip ||
        req.socket?.remoteAddress ||
        'unknown';
      const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
      const key = `${ip}:${routeKey}`;

      const now = Date.now();
      const windowMs = opts.windowSeconds * 1000;
      const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);

      if (recent.length >= opts.limit) {
        throw new HttpException(
          {
            message: 'Trop de tentatives. Réessayez dans quelques instants.',
            code: 'RATE_LIMIT_EXCEEDED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      recent.push(now);
      this.hits.set(key, recent);

      // GC léger pour éviter une croissance illimitée de la Map.
      if (this.hits.size > 10000) {
        for (const [k, v] of this.hits) {
          if (v.every((t) => now - t >= windowMs)) this.hits.delete(k);
        }
      }

      return true;
    } catch (e) {
      if (e instanceof HttpException) throw e; // la 429 doit remonter
      this.logger.warn(`RateLimitGuard erreur (fail-open): ${(e as Error).message}`);
      return true; // fail-open
    }
  }
}
