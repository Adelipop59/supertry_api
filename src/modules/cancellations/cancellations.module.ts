import { Module } from '@nestjs/common';
import { CancellationsService } from './cancellations.service';
import { CancellationsController } from './cancellations.controller';
import { PrismaModule } from '../../database/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    PaymentsModule,
    BusinessRulesModule,
    AuditModule,
  ],
  controllers: [CancellationsController],
  providers: [CancellationsService],
  exports: [CancellationsService],
})
export class CancellationsModule {}
