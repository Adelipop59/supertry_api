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
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { CriteriaTemplatesService } from './criteria-templates.service';
import { CreateCriteriaTemplateDto } from './dto/create-criteria-template.dto';
import { UpdateCriteriaTemplateDto } from './dto/update-criteria-template.dto';
import { CriteriaTemplateResponseDto } from './dto/criteria-template-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Criteria Templates')
@Controller('criteria-templates')
@Roles(UserRole.PRO, UserRole.ADMIN)
export class CriteriaTemplatesController {
  constructor(
    private readonly criteriaTemplatesService: CriteriaTemplatesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer un template de critères', description: 'Le vendeur crée un template de critères réutilisable pour ses campagnes' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async create(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateCriteriaTemplateDto,
  ): Promise<CriteriaTemplateResponseDto> {
    return this.criteriaTemplatesService.create(userId, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Lister mes templates de critères', description: 'Le vendeur récupère la liste de tous ses templates de critères' })
  @ApiAuthResponses()
  async findAll(
    @CurrentUser('id') userId: string,
  ): Promise<CriteriaTemplateResponseDto[]> {
    return this.criteriaTemplatesService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'un template de critères', description: 'Récupère les détails d\'un template de critères spécifique' })
  @ApiParam({ name: 'id', description: 'ID du template de critères', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<CriteriaTemplateResponseDto> {
    return this.criteriaTemplatesService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un template de critères', description: 'Le vendeur met à jour un template de critères existant' })
  @ApiParam({ name: 'id', description: 'ID du template de critères', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateCriteriaTemplateDto,
  ): Promise<CriteriaTemplateResponseDto> {
    return this.criteriaTemplatesService.update(id, userId, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un template de critères', description: 'Le vendeur supprime un template de critères' })
  @ApiParam({ name: 'id', description: 'ID du template de critères', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.criteriaTemplatesService.remove(id, userId);
  }
}
