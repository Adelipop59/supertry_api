import { Module } from '@nestjs/common';
import { CriteriaTemplatesService } from './criteria-templates.service';
import { CriteriaTemplatesController } from './criteria-templates.controller';

@Module({
  controllers: [CriteriaTemplatesController],
  providers: [CriteriaTemplatesService],
  exports: [CriteriaTemplatesService],
})
export class CriteriaTemplatesModule {}
