import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignActivationScheduler } from './campaign-activation.scheduler';
import { PaymentsModule } from '../payments/payments.module';
import { StripeModule } from '../stripe/stripe.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PaymentsModule,
    StripeModule,
    BusinessRulesModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignActivationScheduler],
  exports: [CampaignsService],
})
export class CampaignsModule {}
