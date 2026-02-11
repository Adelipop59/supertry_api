import { NotificationPriority, NotificationTemplate } from '../enums';

export interface NotificationOptions {
  to: string | string[];
  subject?: string;
  template: NotificationTemplate;
  variables?: Record<string, any>;
  priority?: NotificationPriority;
  metadata?: Record<string, any>;
}
