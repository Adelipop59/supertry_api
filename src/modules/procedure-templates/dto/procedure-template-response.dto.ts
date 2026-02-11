import { StepTemplateResponseDto } from './step-template-response.dto';

export class ProcedureTemplateResponseDto {
  id: string;
  sellerId: string;
  name: string;
  title: string;
  description: string;
  steps: StepTemplateResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
