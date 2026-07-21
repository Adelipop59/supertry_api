import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { LuciaAuthGuard } from '../../common/guards/lucia-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { CreateDisputeMessageDto } from './dto/create-dispute-message.dto';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';

@ApiTags('Disputes')
@Controller('disputes')
@UseGuards(LuciaAuthGuard, RolesGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @ApiOperation({ summary: 'Créer un litige sur une session de test' })
  @ApiResponse({ status: 201, description: 'Litige créé avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  @Post('sessions/:id/dispute')
  @Roles(UserRole.USER, UserRole.PRO)
  async createDispute(
    @Param('id') sessionId: string,
    @Body() dto: CreateDisputeDto,
    // SÉCURITÉ (SEC-S7) : le guard attache `request.user = profile` (clé `id`).
    // L'ancien `req.user.userId` était donc TOUJOURS undefined → litiges journalisés
    // avec userId=null et résolution 403 systématique. On lit l'id via @CurrentUser.
    @CurrentUser('id') userId: string,
  ) {
    return this.disputesService.createDispute(sessionId, userId, dto);
  }

  @ApiOperation({ summary: 'Résoudre un litige (ADMIN)' })
  @ApiResponse({ status: 200, description: 'Litige résolu avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  @Post('sessions/:id/resolve')
  @Roles(UserRole.ADMIN)
  async resolveDispute(
    @Param('id') sessionId: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.disputesService.resolveDispute(sessionId, adminId, dto);
  }

  @ApiOperation({ summary: 'Lister les litiges (ADMIN)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filtrer par statut de litige', example: 'DISPUTED' })
  @ApiResponse({ status: 200, description: 'Liste des litiges' })
  @ApiAuthResponses()
  @Get()
  @Roles(UserRole.ADMIN)
  async getDisputes(@Query('status') status?: string) {
    return this.disputesService.getDisputesByStatus(status);
  }

  @ApiOperation({ summary: 'Détails d\'un litige' })
  @ApiResponse({ status: 200, description: 'Détails du litige' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Get('sessions/:id')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  async getDisputeDetails(
    @Param('id') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.disputesService.getDisputeDetails(sessionId, userId);
  }

  @ApiOperation({
    summary: 'Lister les messages du litige (filtré par visibilité selon le rôle)',
  })
  @ApiResponse({ status: 200, description: 'Liste des messages du litige' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Get('sessions/:id/messages')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  async getDisputeMessages(
    @Param('id') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.disputesService.getDisputeMessages(sessionId, userId);
  }

  @ApiOperation({ summary: 'Envoyer un message dans le litige' })
  @ApiResponse({ status: 201, description: 'Message envoyé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  @Post('sessions/:id/messages')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  async createDisputeMessage(
    @Param('id') sessionId: string,
    @Body() dto: CreateDisputeMessageDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.disputesService.createDisputeMessage(sessionId, userId, dto);
  }
}
