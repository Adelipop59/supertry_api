import { NotificationType } from '../enums';

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  provider: string;
  type: NotificationType;
  error?: string;
  sentAt: Date;
}
