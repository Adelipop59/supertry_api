import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { WebhookHandlersService } from './handlers/webhook-handlers.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [StripeService, WebhookHandlersService, PaymentReconciliationService],
  controllers: [StripeController],
  exports: [StripeService, PaymentReconciliationService],
})
export class StripeModule {}
