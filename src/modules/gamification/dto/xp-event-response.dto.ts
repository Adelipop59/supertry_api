import { XpEventType } from '@prisma/client';

export class XpEventResponseDto {
  id: string;
  type: XpEventType;
  amount: number;
  description: string | null;
  sessionId: string | null;
  createdAt: Date;
}
