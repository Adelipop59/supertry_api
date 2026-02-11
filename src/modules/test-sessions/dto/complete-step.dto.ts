import { IsNotEmpty, IsObject } from 'class-validator';

export class CompleteStepDto {
  @IsNotEmpty()
  @IsObject()
  submissionData: any; // JSON data: photos/videos/text/checklist/rating based on StepType
}
