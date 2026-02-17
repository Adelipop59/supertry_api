import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { LuciaAuthGuard } from '../../common/guards/lucia-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
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
    @Request() req: any,
  ) {
    return this.disputesService.createDispute(sessionId, req.user.userId, dto);
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
    @Request() req: any,
  ) {
    return this.disputesService.resolveDispute(
      sessionId,
      req.user.userId,
      dto,
    );
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
    @Request() req: any,
  ) {
    return this.disputesService.getDisputeDetails(sessionId, req.user.userId);
  }
}
