export class KycStatusResponseDto {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirements: {
    currentlyDue: string[];
    pastDue: string[];
    eventuallyDue: string[];
  };
}

export class KycRequiredResponseDto {
  kycRequired: boolean;
  accountExists: boolean;
  onboardingUrl?: string;
  message?: string;
}
