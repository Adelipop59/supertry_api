import { PartialType } from '@nestjs/swagger';
import { CreateCriteriaTemplateDto } from './create-criteria-template.dto';

export class UpdateCriteriaTemplateDto extends PartialType(
  CreateCriteriaTemplateDto,
) {}
