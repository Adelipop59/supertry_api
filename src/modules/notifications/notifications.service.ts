import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { NodemailerProvider } from './providers/email/nodemailer.provider';
import { TwilioProvider } from './providers/sms/twilio.provider';
import { SendEmailDto, SendSmsDto } from './dto';
import { NotificationResult } from './interfaces/notification-result.interface';
import { NotificationStatus, NotificationChannel } from './enums';
import { NotificationType } from '@prisma/client';
import { NOTIFICATION_QUEUES } from './constants/notification.constants';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly emailProvider: NodemailerProvider,
    private readonly smsProvider: TwilioProvider,
    @InjectQueue(NOTIFICATION_QUEUES.EMAIL) private emailQueue: Queue,
    @InjectQueue(NOTIFICATION_QUEUES.SMS) private smsQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Send email directly (synchronous)
   */
  async sendEmail(dto: SendEmailDto): Promise<NotificationResult> {
    this.logger.log(`Sending email to ${dto.to}`);

    const notification = await this.saveNotification({
      type: NotificationChannel.EMAIL,
      recipient: dto.to,
      template: dto.template,
      subject: dto.subject,
      variables: dto.variables,
      metadata: dto.metadata,
      status: NotificationStatus.PENDING,
    });

    const result = await this.emailProvider.send(dto);

    await this.updateNotification(notification.id, {
      status: result.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
      messageId: result.messageId,
      error: result.error,
      sentAt: result.sentAt,
    });

    return result;
  }

  /**
   * Queue email for asynchronous sending
   */
  async queueEmail(dto: SendEmailDto): Promise<{ jobId: string; notificationId: string }> {
    this.logger.log(`Queueing email to ${dto.to}`);

    const notification = await this.saveNotification({
      type: dto.metadata?.type || NotificationType.SYSTEM_ALERT,
      recipient: dto.to,
      template: dto.template,
      subject: dto.subject,
      variables: dto.variables,
      metadata: dto.metadata,
      status: NotificationStatus.PENDING,
    });

    const job = await this.emailQueue.add({
      ...dto,
      notificationId: notification.id,
    });

    return {
      jobId: job.id.toString(),
      notificationId: notification.id,
    };
  }

  /**
   * Send SMS directly (synchronous)
   */
  async sendSMS(dto: SendSmsDto): Promise<NotificationResult> {
    this.logger.log(`Sending SMS to ${dto.to}`);

    const notification = await this.saveNotification({
      type: NotificationChannel.SMS,
      recipient: dto.to,
      template: dto.template,
      variables: dto.variables,
      metadata: dto.metadata,
      status: NotificationStatus.PENDING,
    });

    const result = await this.smsProvider.send(dto);

    await this.updateNotification(notification.id, {
      status: result.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
      messageId: result.messageId,
      error: result.error,
      sentAt: result.sentAt,
    });

    return result;
  }

  /**
   * Queue SMS for asynchronous sending
   */
  async queueSMS(dto: SendSmsDto): Promise<{ jobId: string; notificationId: string }> {
    this.logger.log(`Queueing SMS to ${dto.to}`);

    const notification = await this.saveNotification({
      type: NotificationChannel.SMS,
      recipient: dto.to,
      template: dto.template,
      variables: dto.variables,
      metadata: dto.metadata,
      status: NotificationStatus.PENDING,
    });

    const job = await this.smsQueue.add({
      ...dto,
      notificationId: notification.id,
    });

    return {
      jobId: job.id.toString(),
      notificationId: notification.id,
    };
  }

  /**
   * Send multiple notifications (batch)
   */
  async sendBatch(notifications: Array<{ type: string; [key: string]: any }>): Promise<NotificationResult[]> {
    this.logger.log(`Sending batch of ${notifications.length} notifications`);

    const results: NotificationResult[] = [];

    for (const notification of notifications) {
      try {
        if (notification.type === NotificationChannel.EMAIL) {
          const result = await this.sendEmail(notification as unknown as SendEmailDto);
          results.push(result);
        } else if (notification.type === NotificationChannel.SMS) {
          const result = await this.sendSMS(notification as unknown as SendSmsDto);
          results.push(result);
        }
      } catch (error) {
        this.logger.error(`Failed to send notification in batch`, error);
        results.push({
          success: false,
          provider: 'unknown',
          type: notification.type as NotificationChannel,
          error: error.message,
          sentAt: new Date(),
        });
      }
    }

    return results;
  }

  /**
   * Get notification history by recipient
   */
  async getNotificationHistory(userId: string, limit: number = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get notification by ID
   */
  async getNotificationById(id: string) {
    return this.prisma.notification.findUnique({
      where: { id },
    });
  }

  private async saveNotification(data: any) {
    // Try to get userId from metadata or data
    let userId = data.metadata?.userId || data.userId;

    // If no userId and we have a recipient email, try to find the user
    if (!userId && data.recipient) {
      const profile = await this.prisma.profile.findFirst({
        where: { email: data.recipient },
        select: { id: true },
      });
      userId = profile?.id;
    }

    // If still no userId, throw error
    if (!userId) {
      this.logger.warn(`Cannot save notification: userId is missing for recipient ${data.recipient}`);
      throw new Error('userId is required to save notification');
    }

    return this.prisma.notification.create({
      data: {
        userId,
        type: data.type,
        channel: data.channel || (data.type === NotificationChannel.EMAIL ? 'EMAIL' : 'SMS'),
        title: data.subject || data.title || '',
        message: data.template || data.message || '',
        data: data.variables || data.metadata || {},
        isSent: false,
        retries: 0,
      },
    });
  }

  private async updateNotification(id: string, data: any) {
    return this.prisma.notification.update({
      where: { id },
      data,
    });
  }
}
