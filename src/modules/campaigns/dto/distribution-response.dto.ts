import { DistributionType } from '@prisma/client';

export class DistributionResponseDto {
  id: string;
  campaignId: string;
  type: DistributionType;
  dayOfWeek?: number;
  specificDate?: Date;
  maxUnits: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
