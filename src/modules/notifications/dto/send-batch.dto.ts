import { IsArray, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationType } from '../enums';

class BatchNotificationItem {
  @IsEnum(NotificationType)
  type: NotificationType;

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
