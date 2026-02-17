import { IsEnum, IsString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OnboardingLinkType {
  ACCOUNT_ONBOARDING = 'account_onboarding',
  ACCOUNT_UPDATE = 'account_update',
}

export class CreateOnboardingLinkDto {
  @ApiProperty({
    description: "URL de redirection si le lien d'onboarding expire ou échoue",
    example: 'https://supertry.fr/onboarding/refresh',
  })
  @IsUrl({ require_tld: false })
  refreshUrl: string;

  @ApiProperty({
    description: "URL de retour après complétion de l'onboarding",
    example: 'https://supertry.fr/onboarding/complete',
  })
  @IsUrl({ require_tld: false })
  returnUrl: string;

  @ApiPropertyOptional({
    description: "Type de lien d'onboarding Stripe",
    enum: OnboardingLinkType,
    default: OnboardingLinkType.ACCOUNT_ONBOARDING,
    example: 'account_onboarding',
  })
  @IsEnum(OnboardingLinkType)
  type?: OnboardingLinkType = OnboardingLinkType.ACCOUNT_ONBOARDING;
}
