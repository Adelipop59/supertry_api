import { PartialType } from '@nestjs/mapped-types';
import { CreateBusinessRulesDto } from './create-business-rules.dto';

export class UpdateBusinessRulesDto extends PartialType(CreateBusinessRulesDto) {}
