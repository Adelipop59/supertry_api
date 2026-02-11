import { StepType } from '@prisma/client';

export class StepResponseDto {
  id: string;
  procedureId: string;
  title: string;
  description?: string;
  type: StepType;
  order: number;
  isRequired: boolean;
  checklistItems?: any;
  createdAt: Date;
  updatedAt: Date;
}
