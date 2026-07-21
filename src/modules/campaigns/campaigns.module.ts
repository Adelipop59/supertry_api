import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { PaymentsModule } from '../payments/payments.module';
import { StripeModule } from '../stripe/stripe.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    PaymentsModule,
    StripeModule,
    BusinessRulesModule,
    AuditModule,
    NotificationsModule,
    MediaModule,
  ],
  controllers: [CampaignsController],
  // CampaignActivationScheduler supprimé : il activait les campagnes PENDING_ACTIVATION
  // SANS capturer le paiement (risque de campagne active jamais débitée). La capture +
  // activation atomique est assurée par PaymentCaptureScheduler (payments module).
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
