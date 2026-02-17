import { PartialType } from '@nestjs/swagger';
import { CreateBusinessRulesDto } from './create-business-rules.dto';

export class UpdateBusinessRulesDto extends PartialType(CreateBusinessRulesDto) {}
