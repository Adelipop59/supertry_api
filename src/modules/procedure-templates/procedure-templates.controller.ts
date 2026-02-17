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
import { ProcedureTemplatesService } from './procedure-templates.service';
import { CreateProcedureTemplateDto } from './dto/create-procedure-template.dto';
import { UpdateProcedureTemplateDto } from './dto/update-procedure-template.dto';
import { ProcedureTemplateResponseDto } from './dto/procedure-template-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Procedure Templates')
@Controller('procedure-templates')
@Roles(UserRole.PRO, UserRole.ADMIN)
export class ProcedureTemplatesController {
  constructor(
    private readonly procedureTemplatesService: ProcedureTemplatesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer un template de procédure', description: 'Le vendeur crée un template de procédure de test réutilisable avec ses étapes' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async create(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateProcedureTemplateDto,
  ): Promise<ProcedureTemplateResponseDto> {
    return this.procedureTemplatesService.create(userId, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Lister mes templates de procédure', description: 'Le vendeur récupère la liste de tous ses templates de procédure' })
  @ApiAuthResponses()
  async findAll(
    @CurrentUser('id') userId: string,
  ): Promise<ProcedureTemplateResponseDto[]> {
    return this.procedureTemplatesService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'un template de procédure', description: 'Récupère les détails d\'un template de procédure avec toutes ses étapes' })
  @ApiParam({ name: 'id', description: 'ID du template de procédure', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ProcedureTemplateResponseDto> {
    return this.procedureTemplatesService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un template de procédure', description: 'Le vendeur met à jour un template de procédure existant et ses étapes' })
  @ApiParam({ name: 'id', description: 'ID du template de procédure', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateProcedureTemplateDto,
  ): Promise<ProcedureTemplateResponseDto> {
    return this.procedureTemplatesService.update(id, userId, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un template de procédure', description: 'Le vendeur supprime un template de procédure et toutes ses étapes' })
  @ApiParam({ name: 'id', description: 'ID du template de procédure', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.procedureTemplatesService.remove(id, userId);
  }
}
