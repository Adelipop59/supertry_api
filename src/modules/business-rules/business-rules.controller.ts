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
import { BusinessRulesService } from './business-rules.service';
import { CreateBusinessRulesDto } from './dto/create-business-rules.dto';
import { UpdateBusinessRulesDto } from './dto/update-business-rules.dto';
import { BusinessRulesResponseDto } from './dto/business-rules-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@Controller('business-rules')
export class BusinessRulesController {
  constructor(private readonly businessRulesService: BusinessRulesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreateBusinessRulesDto,
  ): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.create(createDto);
  }

  @Get()
  @Public()
  async findAll(): Promise<BusinessRulesResponseDto[]> {
    return this.businessRulesService.findAll();
  }

  @Get('latest')
  @Public()
  async findLatest(): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.findLatest();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  async findOne(@Param('id') id: string): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateBusinessRulesDto,
  ): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.businessRulesService.remove(id);
  }
}
