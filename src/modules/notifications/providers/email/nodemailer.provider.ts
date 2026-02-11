import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { INotificationProvider } from '../../interfaces/notification-provider.interface';
import { NotificationOptions } from '../../interfaces/notification-options.interface';
import { NotificationResult } from '../../interfaces/notification-result.interface';
import { NotificationType, NotificationTemplate } from '../../enums';
import { NOTIFICATION_PROVIDERS } from '../../constants/notification.constants';

@Injectable()
export class NodemailerProvider implements INotificationProvider {
  private readonly logger = new Logger(NodemailerProvider.name);
  private transporter: Transporter;
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
    this.preloadTemplates();
  }

  private initializeTransporter(): void {
    const emailConfig = this.configService.get('notification.email');

    this.transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: {
        user: emailConfig.user,
        pass: emailConfig.password,
      },
    });

    this.logger.log('Nodemailer transporter initialized');
  }

  private preloadTemplates(): void {
    const templatesPath = path.join(__dirname, 'templates');
    const emailTemplates = [
      NotificationTemplate.ACCOUNT_VERIFICATION,
      NotificationTemplate.PASSWORD_RESET,
      NotificationTemplate.ACCOUNT_DELETION,
      NotificationTemplate.ORDER_CONFIRMATION,
      NotificationTemplate.GENERIC_NOTIFICATION,
    ];

    emailTemplates.forEach((template) => {
      const templatePath = path.join(templatesPath, `${template}.hbs`);
      if (fs.existsSync(templatePath)) {
        const templateContent = fs.readFileSync(templatePath, 'utf-8');
        this.templateCache.set(template, Handlebars.compile(templateContent));
        this.logger.debug(`Template loaded: ${template}`);
      }
    });
  }

  async send(options: NotificationOptions): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      const compiledTemplate = this.templateCache.get(options.template);
      if (!compiledTemplate) {
        throw new Error(`Template not found: ${options.template}`);
      }

      const emailConfig = this.configService.get('notification.email');
      const html = compiledTemplate({
        ...options.variables,
        fromName: emailConfig.fromName,
      });

      const mailOptions = {
        from: `${emailConfig.fromName} <${emailConfig.fromAddress}>`,
        to: options.to,
        subject: options.subject || this.getDefaultSubject(options.template),
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.log('Email sent successfully', {
        to: options.to,
        template: options.template,
        messageId: info.messageId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        messageId: info.messageId,
        provider: this.getProviderName(),
        type: NotificationType.EMAIL,
        sentAt: new Date(),
      };
    } catch (error) {
      this.logger.error('Failed to send email', {
        to: options.to,
        template: options.template,
        error: error.message,
      });

      return {
        success: false,
        provider: this.getProviderName(),
        type: NotificationType.EMAIL,
        error: error.message,
        sentAt: new Date(),
      };
    }
  }

  validateConfig(): boolean {
    const emailConfig = this.configService.get('notification.email');
    return !!(
      emailConfig?.host &&
      emailConfig?.user &&
      emailConfig?.password &&
      emailConfig?.fromAddress
    );
  }

  getProviderName(): string {
    return NOTIFICATION_PROVIDERS.NODEMAILER;
  }

  private getDefaultSubject(template: NotificationTemplate): string {
    const subjects: Record<string, string> = {
      [NotificationTemplate.ACCOUNT_VERIFICATION]: 'Vérifiez votre compte',
      [NotificationTemplate.PASSWORD_RESET]: 'Réinitialisation de mot de passe',
      [NotificationTemplate.ACCOUNT_DELETION]: 'Compte supprimé',
      [NotificationTemplate.ORDER_CONFIRMATION]: 'Confirmation de commande',
      [NotificationTemplate.GENERIC_NOTIFICATION]: 'Notification',
    };

    return subjects[template] || 'Notification';
  }
}
