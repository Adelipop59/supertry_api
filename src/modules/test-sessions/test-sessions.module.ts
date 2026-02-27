import { Module } from '@nestjs/common';
import { TestSessionsService } from './test-sessions.service';
import { TestSessionsController } from './test-sessions.controller';
import { PaymentsModule } from '../payments/payments.module';
import { StripeModule } from '../stripe/stripe.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { MediaModule } from '../media/media.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [PaymentsModule, StripeModule, BusinessRulesModule, MediaModule, MessagesModule],
  controllers: [TestSessionsController],
  providers: [TestSessionsService],
  exports: [TestSessionsService],
})
export class TestSessionsModule {}
