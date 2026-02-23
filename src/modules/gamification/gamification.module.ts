import { Global, Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { BusinessRulesModule } from '../business-rules/business-rules.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Global()
@Module({
  imports: [BusinessRulesModule, NotificationsModule],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
