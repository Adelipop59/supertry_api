import { IsEnum, IsNotEmpty, IsObject, IsOptional, Matches } from 'class-validator';
import { NotificationPriority, NotificationTemplate } from '../enums';

export class SendSmsDto {
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone number must be in E.164 format (e.g., +33612345678)',
  })
  @IsNotEmpty()
  to: string;

  @IsEnum(NotificationTemplate)
  @IsNotEmpty()
  template: NotificationTemplate;

  @IsObject()
  @IsOptional()
  variables?: Record<string, any>;

  @IsEnum(NotificationPriority)
  @IsOptional()
  priority?: NotificationPriority;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
