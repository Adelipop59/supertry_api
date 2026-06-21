import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { WalletReconciliationScheduler } from './wallet-reconciliation.scheduler';
import { PrismaModule } from '../../database/prisma.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [PrismaModule, StripeModule],
  providers: [WalletService, WalletReconciliationScheduler],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
