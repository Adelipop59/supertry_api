import { StepResponseDto } from './step-response.dto';

export class ProcedureResponseDto {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  order: number;
  isRequired: boolean;
  steps: StepResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
