import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class KycRequirementsDto {
  @ApiProperty({ description: 'Documents/informations actuellement requis', example: ['individual.verification.document'] })
  currentlyDue: string[];

  @ApiProperty({ description: 'Documents/informations en retard', example: [] })
  pastDue: string[];

  @ApiProperty({ description: 'Documents/informations qui seront requis à terme', example: ['individual.verification.additional_document'] })
  eventuallyDue: string[];
}

export class KycStatusResponseDto {
  @ApiProperty({ description: 'Indique si le compte peut recevoir des paiements', example: true })
  chargesEnabled: boolean;

  @ApiProperty({ description: 'Indique si le compte peut effectuer des virements', example: true })
  payoutsEnabled: boolean;

  @ApiProperty({ description: "Indique si les informations d'identité ont été soumises", example: true })
  detailsSubmitted: boolean;

  @ApiProperty({ description: 'Exigences KYC restantes', type: KycRequirementsDto })
  requirements: {
    currentlyDue: string[];
    pastDue: string[];
    eventuallyDue: string[];
  };
}

export class KycRequiredResponseDto {
  @ApiProperty({ description: 'Indique si la vérification KYC est requise', example: true })
  kycRequired: boolean;

  @ApiProperty({ description: 'Indique si un compte Stripe Connect existe déjà', example: false })
  accountExists: boolean;

  @ApiPropertyOptional({ description: "URL d'onboarding Stripe", example: 'https://connect.stripe.com/setup/...' })
  onboardingUrl?: string;

  @ApiPropertyOptional({ description: 'Message informatif', example: 'Create Stripe Connect account first' })
  message?: string;
}
