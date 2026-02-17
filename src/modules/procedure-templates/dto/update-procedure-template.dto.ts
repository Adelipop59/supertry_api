import { PartialType } from '@nestjs/swagger';
import { CreateProcedureTemplateDto } from './create-procedure-template.dto';

export class UpdateProcedureTemplateDto extends PartialType(
  CreateProcedureTemplateDto,
) {}
