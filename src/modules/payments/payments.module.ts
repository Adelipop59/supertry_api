import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentCaptureScheduler } from './payment-capture.scheduler';
import { InvoiceService } from './invoice.service';
import { PrismaModule } from '../../database/prisma.module';
import { StripeModule } from '../stripe/stripe.module';
import { WalletModule } from '../wallet/wallet.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';

@Module({
  imports: [PrismaModule, StripeModule, WalletModule, BusinessRulesModule],
  providers: [PaymentsService, PaymentCaptureScheduler, InvoiceService],
  controllers: [PaymentsController],
  exports: [PaymentsService, InvoiceService],
})
export class PaymentsModule {}
