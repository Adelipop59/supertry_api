import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { WebhookHandlersService } from './handlers/webhook-handlers.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [StripeService, WebhookHandlersService],
  controllers: [StripeController],
  exports: [StripeService],
})
export class StripeModule {}
