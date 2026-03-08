import { NotificationChannel } from '@prisma/client';

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  provider: string;
  type: NotificationChannel;
  error?: string;
  sentAt: Date;
}
