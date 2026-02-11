import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify which roles are allowed to access a route
 * @param roles - Array of allowed UserRole values
 * @example
 * @Roles(UserRole.ADMIN)
 * @Roles(UserRole.PRO, UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
