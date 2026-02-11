import { PartialType } from '@nestjs/mapped-types';
import { CreateCriteriaTemplateDto } from './create-criteria-template.dto';

export class UpdateCriteriaTemplateDto extends PartialType(
  CreateCriteriaTemplateDto,
) {}
