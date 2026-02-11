import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService], // Export pour utiliser dans d'autres modules
})
export class MediaModule {}
