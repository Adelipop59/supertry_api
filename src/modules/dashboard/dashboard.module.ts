import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../../database/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { StripeModule } from '../stripe/stripe.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [PrismaModule, WalletModule, StripeModule, MessagesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
