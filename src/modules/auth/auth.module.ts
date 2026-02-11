import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { LuciaModule } from '../lucia/lucia.module';
import { StripeModule } from '../stripe/stripe.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [UsersModule, LuciaModule, StripeModule, WalletModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
