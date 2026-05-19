import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StripeModule } from '../stripe/stripe.module';
import { TipsController } from './tips.controller';
import { TipsService } from './tips.service';

@Module({
  imports: [
    PrismaModule,
    StripeModule,
    BusinessRulesModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [TipsController],
  providers: [TipsService],
  exports: [TipsService],
})
export class TipsModule {}
