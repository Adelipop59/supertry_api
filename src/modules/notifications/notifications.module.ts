import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { NotificationsService } from './notifications.service';
import { NodemailerProvider } from './providers/email/nodemailer.provider';
import { TwilioProvider } from './providers/sms/twilio.provider';
import { EmailProcessor } from './processors/email.processor';
import { SmsProcessor } from './processors/sms.processor';
import { NOTIFICATION_QUEUES } from './constants/notification.constants';
import notificationConfig from './config/notification.config';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(notificationConfig),
    BullModule.registerQueue(
      {
        name: NOTIFICATION_QUEUES.EMAIL,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
      {
        name: NOTIFICATION_QUEUES.SMS,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    ),
  ],
  providers: [
    NotificationsService,
    NodemailerProvider,
    TwilioProvider,
    EmailProcessor,
    SmsProcessor,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
