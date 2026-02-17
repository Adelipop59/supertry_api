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
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BusinessRulesService } from './business-rules.service';
import { CreateBusinessRulesDto } from './dto/create-business-rules.dto';
import { UpdateBusinessRulesDto } from './dto/update-business-rules.dto';
import { BusinessRulesResponseDto } from './dto/business-rules-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Business Rules')
@Controller('business-rules')
export class BusinessRulesController {
  constructor(private readonly businessRulesService: BusinessRulesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer des règles métier' })
  @ApiResponse({ status: 201, description: 'Règles métier créées avec succès', type: BusinessRulesResponseDto })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async create(
    @Body() createDto: CreateBusinessRulesDto,
  ): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.create(createDto);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Lister toutes les règles métier' })
  @ApiResponse({ status: 200, description: 'Liste des règles métier', type: [BusinessRulesResponseDto] })
  async findAll(): Promise<BusinessRulesResponseDto[]> {
    return this.businessRulesService.findAll();
  }

  @Get('latest')
  @Public()
  @ApiOperation({ summary: 'Récupérer les règles métier en vigueur' })
  @ApiResponse({ status: 200, description: 'Règles métier en vigueur', type: BusinessRulesResponseDto })
  async findLatest(): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.findLatest();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Récupérer des règles métier par ID' })
  @ApiResponse({ status: 200, description: 'Règles métier trouvées', type: BusinessRulesResponseDto })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async findOne(@Param('id') id: string): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Modifier des règles métier' })
  @ApiResponse({ status: 200, description: 'Règles métier modifiées avec succès', type: BusinessRulesResponseDto })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateBusinessRulesDto,
  ): Promise<BusinessRulesResponseDto> {
    return this.businessRulesService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer des règles métier' })
  @ApiResponse({ status: 204, description: 'Règles métier supprimées avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async remove(@Param('id') id: string): Promise<void> {
    return this.businessRulesService.remove(id);
  }
}
