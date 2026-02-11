import { IsArray, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { NotificationPriority, NotificationTemplate } from '../enums';

export class SendPushDto {
  @IsArray()
  @IsString({ each: true })
  @Length(32, 256, { each: true })
  @IsNotEmpty()
  to: string[];

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
