import { Module } from '@nestjs/common';
import { ProcedureTemplatesService } from './procedure-templates.service';
import { ProcedureTemplatesController } from './procedure-templates.controller';

@Module({
  controllers: [ProcedureTemplatesController],
  providers: [ProcedureTemplatesService],
  exports: [ProcedureTemplatesService],
})
export class ProcedureTemplatesModule {}
