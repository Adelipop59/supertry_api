import { IsArray, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationChannel } from '../enums';

class BatchNotificationItem {
  @IsEnum(NotificationChannel)
  type: NotificationChannel;

  to: string | string[];
  subject?: string;
  template: string;
  variables?: Record<string, any>;
  metadata?: Record<string, any>;
}

export class SendBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchNotificationItem)
  notifications: BatchNotificationItem[];
}
