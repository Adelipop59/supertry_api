import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TranslationService } from './translation.service';
import { TranslationController } from './translation.controller';

@Module({
  imports: [ConfigModule],
  controllers: [TranslationController],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
