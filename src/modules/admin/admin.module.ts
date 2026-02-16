import { Module } from '@nestjs/common';
import { AdminFinanceController } from './admin-finance.controller';
import { AdminFinanceService } from './admin-finance.service';
import { PrismaModule } from '../../database/prisma.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [PrismaModule, StripeModule],
  controllers: [AdminFinanceController],
  providers: [AdminFinanceService],
})
export class AdminModule {}
