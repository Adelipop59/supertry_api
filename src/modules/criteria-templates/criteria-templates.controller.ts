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
import { CriteriaTemplatesService } from './criteria-templates.service';
import { CreateCriteriaTemplateDto } from './dto/create-criteria-template.dto';
import { UpdateCriteriaTemplateDto } from './dto/update-criteria-template.dto';
import { CriteriaTemplateResponseDto } from './dto/criteria-template-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('criteria-templates')
@Roles(UserRole.PRO, UserRole.ADMIN)
export class CriteriaTemplatesController {
  constructor(
    private readonly criteriaTemplatesService: CriteriaTemplatesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateCriteriaTemplateDto,
  ): Promise<CriteriaTemplateResponseDto> {
    return this.criteriaTemplatesService.create(userId, createDto);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
  ): Promise<CriteriaTemplateResponseDto[]> {
    return this.criteriaTemplatesService.findAll(userId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<CriteriaTemplateResponseDto> {
    return this.criteriaTemplatesService.findOne(id, userId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateCriteriaTemplateDto,
  ): Promise<CriteriaTemplateResponseDto> {
    return this.criteriaTemplatesService.update(id, userId, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.criteriaTemplatesService.remove(id, userId);
  }
}
