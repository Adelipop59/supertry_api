import { Injectable } from '@nestjs/common';
import { INotificationProvider } from '../../interfaces/notification-provider.interface';
import { NotificationOptions } from '../../interfaces/notification-options.interface';
import { NotificationResult } from '../../interfaces/notification-result.interface';

/**
 * Push notification provider interface
 * This is a placeholder for future implementation
 * 
 * To implement:
 * 1. Choose a push provider (Firebase FCM, OneSignal, etc.)
 * 2. Install the SDK: pnpm add firebase-admin (for FCM)
 * 3. Implement the send() method
 * 4. Add configuration in notification.config.ts
 * 5. Register in NotificationsModule
 */
@Injectable()
export class PushProvider implements INotificationProvider {
  async send(options: NotificationOptions): Promise<NotificationResult> {
    throw new Error('Push notifications not implemented yet');
  }

  validateConfig(): boolean {
    return false;
  }

  getProviderName(): string {
    return 'push';
  }
}
