import { SetMetadata } from '@nestjs/common';

export const SkipOnboarding = () => SetMetadata('skipOnboarding', true);
