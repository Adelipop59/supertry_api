import { Module } from '@nestjs/common';
import { BusinessRulesService } from './business-rules.service';
import { BusinessRulesController } from './business-rules.controller';

@Module({
  controllers: [BusinessRulesController],
  providers: [BusinessRulesService],
  exports: [BusinessRulesService],
})
export class BusinessRulesModule {}
