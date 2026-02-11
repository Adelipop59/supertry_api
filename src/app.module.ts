import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { LuciaModule } from './modules/lucia/lucia.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { ProcedureTemplatesModule } from './modules/procedure-templates/procedure-templates.module';
import { CriteriaTemplatesModule } from './modules/criteria-templates/criteria-templates.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { TestSessionsModule } from './modules/test-sessions/test-sessions.module';
import { BusinessRulesModule } from './modules/business-rules/business-rules.module';
import { MediaModule } from './modules/media/media.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { CancellationsModule } from './modules/cancellations/cancellations.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { LuciaAuthGuard } from './common/guards/lucia-auth.guard';
import { OnboardingGuard } from './common/guards/onboarding.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    LuciaModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    ProcedureTemplatesModule,
    CriteriaTemplatesModule,
    CampaignsModule,
    TestSessionsModule,
    BusinessRulesModule,
    MediaModule,
    StripeModule,
    WalletModule,
    PaymentsModule,
    WithdrawalsModule,
    CancellationsModule,
    DisputesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: LuciaAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: OnboardingGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
