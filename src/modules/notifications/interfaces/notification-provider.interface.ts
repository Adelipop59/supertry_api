import { NotificationOptions } from './notification-options.interface';
import { NotificationResult } from './notification-result.interface';

export interface INotificationProvider {
  send(options: NotificationOptions): Promise<NotificationResult>;
  validateConfig(): boolean;
  getProviderName(): string;
}
