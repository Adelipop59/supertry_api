// Queue names
export const NOTIFICATION_QUEUES = {
  EMAIL: 'notifications:email',
  SMS: 'notifications:sms',
} as const;

// Provider names
export const NOTIFICATION_PROVIDERS = {
  NODEMAILER: 'nodemailer',
  TWILIO: 'twilio',
} as const;

// Injection tokens
export const NOTIFICATION_TOKENS = {
  EMAIL_PROVIDER: 'EMAIL_PROVIDER',
  SMS_PROVIDER: 'SMS_PROVIDER',
  PUSH_PROVIDER: 'PUSH_PROVIDER',
} as const;
