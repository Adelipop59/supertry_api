import { Module } from '@nestjs/common';
import { UgcController } from './ugc.controller';
import { UgcService } from './ugc.service';
import { PrismaModule } from '../../database/prisma.module';
import { StripeModule } from '../stripe/stripe.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    StripeModule,
    BusinessRulesModule,
    MediaModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [UgcController],
  providers: [UgcService],
  exports: [UgcService],
})
export class UgcModule {}
