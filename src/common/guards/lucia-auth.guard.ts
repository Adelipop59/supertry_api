import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LuciaService } from '../../modules/lucia/lucia.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class LuciaAuthGuard implements CanActivate {
  constructor(
    private luciaService: LuciaService,
    private prismaService: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is public
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Support cookie-based auth (web) et Bearer token auth (mobile)
    // Le Bearer token contient le session ID (identique au cookie auth_session)
    const authHeader = request.headers?.authorization;
    const bearerSessionId = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionId = request.cookies?.['auth_session'] || bearerSessionId || '';

    if (!sessionId) {
      throw new UnauthorizedException('Missing session');
    }

    const result = await this.luciaService.validateSession(sessionId);

    if (!result.session || !result.user) {
      throw new UnauthorizedException('Invalid session');
    }

    // Attach user to request
    const profile = await this.prismaService.profile.findUnique({
      where: { id: result.user.id },
    });

    if (!profile || !profile.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    request.user = profile;
    request.session = result.session;

    return true;
  }
}
