import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ProcedureTemplatesService } from './procedure-templates.service';
import { CreateProcedureTemplateDto } from './dto/create-procedure-template.dto';
import { UpdateProcedureTemplateDto } from './dto/update-procedure-template.dto';
import { ProcedureTemplateResponseDto } from './dto/procedure-template-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('procedure-templates')
@Roles(UserRole.PRO, UserRole.ADMIN)
export class ProcedureTemplatesController {
  constructor(
    private readonly procedureTemplatesService: ProcedureTemplatesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateProcedureTemplateDto,
  ): Promise<ProcedureTemplateResponseDto> {
    return this.procedureTemplatesService.create(userId, createDto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
  ): Promise<ProcedureTemplateResponseDto[]> {
    return this.procedureTemplatesService.findAll(userId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ProcedureTemplateResponseDto> {
    return this.procedureTemplatesService.findOne(id, userId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateProcedureTemplateDto,
  ): Promise<ProcedureTemplateResponseDto> {
    return this.procedureTemplatesService.update(id, userId, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.procedureTemplatesService.remove(id, userId);
  }
}
