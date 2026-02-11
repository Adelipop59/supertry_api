import { Process, Processor, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../../database/prisma.service';
import { NodemailerProvider } from '../providers/email/nodemailer.provider';
import { NotificationStatus } from '../enums';
import { NOTIFICATION_QUEUES } from '../constants/notification.constants';
import { SendEmailDto } from '../dto';

@Processor(NOTIFICATION_QUEUES.EMAIL)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly emailProvider: NodemailerProvider,
    private readonly prisma: PrismaService,
  ) {}

  @Process()
  async handleEmailJob(job: Job<SendEmailDto & { notificationId?: string }>) {
    const { data } = job;
    this.logger.log(`Processing email job ${job.id} to ${data.to}`);

    try {
      const result = await this.emailProvider.send(data);

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
      this.logger.error(`Failed to process email job ${job.id}`, error);
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`Email job ${job.id} completed successfully`, {
      messageId: result.messageId,
    });
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error) {
    this.logger.error(`Email job ${job.id} failed`, {
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
