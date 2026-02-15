import { NotificationChannel } from '../enums';

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  provider: string;
  type: NotificationChannel;
  error?: string;
  sentAt: Date;
}
