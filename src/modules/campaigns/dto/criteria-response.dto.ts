export class CampaignCriteriaResponseDto {
  id: string;
  campaignId: string;
  minAge?: number;
  maxAge?: number;
  minRating?: number;
  maxRating?: number;
  minCompletedSessions?: number;
  requiredGender?: string;
  requiredCountries: string[];
  requiredLocations: string[];
  excludedLocations: string[];
  requiredCategories: string[];
  noActiveSessionWithSeller: boolean;
  maxSessionsPerWeek?: number;
  maxSessionsPerMonth?: number;
  minCompletionRate?: number;
  maxCancellationRate?: number;
  minAccountAge?: number;
  lastActiveWithinDays?: number;
  requireVerified: boolean;
  requirePrime: boolean;
  createdAt: Date;
  updatedAt: Date;
}
