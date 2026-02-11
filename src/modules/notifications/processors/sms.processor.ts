import { Process, Processor, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../../database/prisma.service';
import { TwilioProvider } from '../providers/sms/twilio.provider';
import { NotificationStatus } from '../enums';
import { NOTIFICATION_QUEUES } from '../constants/notification.constants';
import { SendSmsDto } from '../dto';

@Processor(NOTIFICATION_QUEUES.SMS)
export class SmsProcessor {
  private readonly logger = new Logger(SmsProcessor.name);

  constructor(
    private readonly smsProvider: TwilioProvider,
    private readonly prisma: PrismaService,
  ) {}

  @Process()
  async handleSmsJob(job: Job<SendSmsDto & { notificationId?: string }>) {
    const { data } = job;
    this.logger.log(`Processing SMS job ${job.id} to ${data.to}`);

    try {
      const result = await this.smsProvider.send(data);

      if (data.notificationId && result.success) {
        await this.prisma.notification.update({
          where: { id: data.notificationId },
          data: {
            isSent: true,
            sentAt: result.sentAt || new Date(),
          },
        });
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to process SMS job ${job.id}`, error);
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`SMS job ${job.id} completed successfully`, {
      messageId: result.messageId,
    });
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error) {
    this.logger.error(`SMS job ${job.id} failed`, {
      error: error.message,
      attempts: job.attemptsMade,
    });

    const { notificationId } = job.data;
    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          isSent: false,
          error: error.message,
          retries: job.attemptsMade || 0,
        },
      });
    }
  }
}
