import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaModule } from '../../database/prisma.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [PrismaModule, StripeModule],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
