import { TesterTier } from '@prisma/client';
import { XpEventResponseDto } from './xp-event-response.dto';

export class XpDashboardResponseDto {
  totalXp: number;
  tier: TesterTier;
  tierName: string;
  nextTier: TesterTier | null;
  nextTierName: string | null;
  xpToNextTier: number | null;
  progressPercent: number;
  maxProductPrice: number;
  completedTests: number;
  recentXpEvents: XpEventResponseDto[];
}
