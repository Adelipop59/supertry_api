export class SessionStepProgressResponseDto {
  id: string;
  sessionId: string;
  stepId: string;
  step: {
    id: string;
    title: string;
    type: string;
    order: number;
  };
  isCompleted: boolean;
  completedAt?: Date;
  submissionData?: any;
  createdAt: Date;
}
