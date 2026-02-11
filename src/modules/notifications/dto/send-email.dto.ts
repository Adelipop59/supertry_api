import { IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { NotificationPriority, NotificationTemplate } from '../enums';

export class SendEmailDto {
  @IsEmail()
  @IsNotEmpty()
  to: string;

  @IsString()
  @IsOptional()
  subject?: string;

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
