import { IsEnum, IsString, IsUrl } from 'class-validator';

export enum OnboardingLinkType {
  ACCOUNT_ONBOARDING = 'account_onboarding',
  ACCOUNT_UPDATE = 'account_update',
}

export class CreateOnboardingLinkDto {
  @IsUrl({ require_tld: false })
  refreshUrl: string;

  @IsUrl({ require_tld: false })
  returnUrl: string;

  @IsEnum(OnboardingLinkType)
  type?: OnboardingLinkType = OnboardingLinkType.ACCOUNT_ONBOARDING;
}
