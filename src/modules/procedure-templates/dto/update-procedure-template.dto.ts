import { PartialType } from '@nestjs/mapped-types';
import { CreateProcedureTemplateDto } from './create-procedure-template.dto';

export class UpdateProcedureTemplateDto extends PartialType(
  CreateProcedureTemplateDto,
) {}
