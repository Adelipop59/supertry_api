import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Guard to check if the authenticated user has the required role(s) to access a route
 * This guard should be applied AFTER LuciaAuthGuard to ensure user is authenticated
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles from the @Roles() decorator
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are specified, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get the authenticated user from the request
    const { user } = context.switchToHttp().getRequest();

    // If no user or no role, deny access
    if (!user || !user.role) {
      return false;
    }

    // Check if user's role is in the list of required roles
    return requiredRoles.includes(user.role);
  }
}
