import { Global, Module } from '@nestjs/common';
import { LuciaService } from './lucia.service';
import { PrismaModule } from '../../database/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [LuciaService],
  exports: [LuciaService],
})
export class LuciaModule {}
