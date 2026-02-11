import { registerAs } from '@nestjs/config';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

export interface NotificationConfig {
  retryAttempts: number;
  retryDelay: number;
  queueConcurrency: number;
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  email: EmailConfig;
  sms: SmsConfig;
}

export default registerAs(
  'notification',
  (): NotificationConfig => ({
    retryAttempts: parseInt(process.env.NOTIFICATION_RETRY_ATTEMPTS || '3', 10),
    retryDelay: parseInt(process.env.NOTIFICATION_RETRY_DELAY || '5000', 10),
    queueConcurrency: parseInt(process.env.NOTIFICATION_QUEUE_CONCURRENCY || '5', 10),
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    },
    email: {
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      user: process.env.EMAIL_USER || '',
      password: process.env.EMAIL_PASSWORD || '',
      fromName: process.env.EMAIL_FROM_NAME || 'SuperTry',
      fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@supertry.com',
    },
    sms: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    },
  }),
);
