# 📧 Module de Notifications

## Installation
1. Config `.env` : `EMAIL_*`, `TWILIO_*`, `DATABASE_URL`, `REDIS_*`
2. `pnpm install && npx prisma migrate dev`
3. Démarrer Redis : `redis-server`

## Usage
```typescript
// Import dans votre module
import { NotificationsModule } from './modules/notifications/notifications.module';

// Injection du service
constructor(private notifications: NotificationsService) {}

// Email direct (synchrone)
await this.notifications.sendEmail({
  to: 'user@mail.com',
  template: NotificationTemplate.ACCOUNT_VERIFICATION,
  variables: { username: 'John', verificationCode: '123456', expiresIn: '15 minutes' }
});

// Email via queue (asynchrone, recommandé pour bulk)
await this.notifications.queueEmail({...});

// SMS via queue
await this.notifications.queueSMS({
  to: '+33612345678',
  template: NotificationTemplate.OTP_CODE,
  variables: { code: '123456' }
});

// Batch (multiple notifications)
await this.notifications.sendBatch([
  { type: 'EMAIL', to: 'user@mail.com', template: 'account-verification', variables: {...} },
  { type: 'SMS', to: '+33612345678', template: 'otp-code', variables: {...} }
]);
```

## Templates disponibles
**Email** : `account-verification`, `password-reset`, `account-deletion`, `order-confirmation`, `generic-notification`  
**SMS** : `otp-code`, `alert`, `generic-sms`

## Troubleshooting
- Email non reçu ? Vérifier SPAM et credentials SMTP dans `.env`
- SMS échoue ? Vérifier format E.164 (+33...) et credits Twilio
- Queue bloquée ? Vérifier que Redis est démarré : `redis-cli ping`
