import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if route skips onboarding check
    const skipOnboarding = this.reflector.get<boolean>('skipOnboarding', context.getHandler());
    if (skipOnboarding) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // Will be caught by auth guard
    }

    if (!user.isOnboarded) {
      throw new ForbiddenException('Please complete your profile');
    }

    return true;
  }
}
