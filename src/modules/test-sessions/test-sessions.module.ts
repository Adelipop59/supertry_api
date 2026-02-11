import { Module } from '@nestjs/common';
import { TestSessionsService } from './test-sessions.service';
import { TestSessionsController } from './test-sessions.controller';
import { PaymentsModule } from '../payments/payments.module';
import { StripeModule } from '../stripe/stripe.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';

@Module({
  imports: [PaymentsModule, StripeModule, BusinessRulesModule],
  controllers: [TestSessionsController],
  providers: [TestSessionsService],
  exports: [TestSessionsService],
})
export class TestSessionsModule {}
