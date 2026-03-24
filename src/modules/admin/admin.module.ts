import { Module } from '@nestjs/common';
import { AdminFinanceController } from './admin-finance.controller';
import { AdminFinanceService } from './admin-finance.service';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminModerationService } from './admin-moderation.service';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminSystemController } from './admin-system.controller';
import { AdminSystemService } from './admin-system.service';
import { PrismaModule } from '../../database/prisma.module';
import { StripeModule } from '../stripe/stripe.module';
import { WalletModule } from '../wallet/wallet.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    PrismaModule,
    StripeModule,
    WalletModule,
    BusinessRulesModule,
    AuditModule,
    NotificationsModule,
    MediaModule,
  ],
  controllers: [
    AdminFinanceController,
    AdminModerationController,
    AdminUsersController,
    AdminOverviewController,
    AdminSystemController,
  ],
  providers: [
    AdminFinanceService,
    AdminModerationService,
    AdminOverviewService,
    AdminSystemService,
  ],
})
export class AdminModule {}
