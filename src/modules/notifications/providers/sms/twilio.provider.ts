import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import * as fs from 'fs';
import * as path from 'path';
import { INotificationProvider } from '../../interfaces/notification-provider.interface';
import { NotificationOptions } from '../../interfaces/notification-options.interface';
import { NotificationResult } from '../../interfaces/notification-result.interface';
import { NotificationChannel, NotificationTemplate } from '../../enums';
import { NOTIFICATION_PROVIDERS } from '../../constants/notification.constants';

interface SmsTemplate {
  template: string;
}

@Injectable()
export class TwilioProvider implements INotificationProvider {
  private readonly logger = new Logger(TwilioProvider.name);
  private twilioClient: Twilio;
  private templateCache: Map<string, SmsTemplate> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeTwilioClient();
    this.preloadTemplates();
  }

  private initializeTwilioClient(): void {
    const smsConfig = this.configService.get('notification.sms');

    this.twilioClient = new Twilio(smsConfig.accountSid, smsConfig.authToken);

    this.logger.log('Twilio client initialized');
  }

  private preloadTemplates(): void {
    const templatesPath = path.join(__dirname, 'templates');
    const smsTemplates = [
      NotificationTemplate.OTP_CODE,
      NotificationTemplate.ALERT,
      NotificationTemplate.GENERIC_SMS,
    ];

    smsTemplates.forEach((template) => {
      const templatePath = path.join(templatesPath, `${template}.json`);
      if (fs.existsSync(templatePath)) {
        const templateContent = fs.readFileSync(templatePath, 'utf-8');
        this.templateCache.set(template, JSON.parse(templateContent));
        this.logger.debug(`SMS template loaded: ${template}`);
      }
    });
  }

  async send(options: NotificationOptions): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      const smsTemplate = this.templateCache.get(options.template);
      if (!smsTemplate) {
        throw new Error(`SMS template not found: ${options.template}`);
      }

      const message = this.compileTemplate(smsTemplate.template, options.variables || {});
      const smsConfig = this.configService.get('notification.sms');

      const result = await this.twilioClient.messages.create({
        body: message,
        from: smsConfig.phoneNumber,
        to: options.to as string,
      });

      this.logger.log('SMS sent successfully', {
        to: options.to,
        template: options.template,
        messageId: result.sid,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        messageId: result.sid,
        provider: this.getProviderName(),
        type: NotificationChannel.SMS,
        sentAt: new Date(),
      };
    } catch (error) {
      this.logger.error('Failed to send SMS', {
        to: options.to,
        template: options.template,
        error: error.message,
      });

      return {
        success: false,
        provider: this.getProviderName(),
        type: NotificationChannel.SMS,
        error: error.message,
        sentAt: new Date(),
      };
    }
  }

  validateConfig(): boolean {
    const smsConfig = this.configService.get('notification.sms');
    return !!(smsConfig?.accountSid && smsConfig?.authToken && smsConfig?.phoneNumber);
  }

  getProviderName(): string {
    return NOTIFICATION_PROVIDERS.TWILIO;
  }

  private compileTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return variables[key] !== undefined ? String(variables[key]) : '';
    });
  }
}
