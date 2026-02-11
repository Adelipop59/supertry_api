import { StepType } from '@prisma/client';

export class StepTemplateResponseDto {
  id: string;
  procedureTemplateId: string;
  title: string;
  description?: string;
  type: StepType;
  order: number;
  isRequired: boolean;
  checklistItems?: any;
  createdAt: Date;
  updatedAt: Date;
}
