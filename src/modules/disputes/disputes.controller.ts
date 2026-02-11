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
import { DisputesService } from './disputes.service';
import { LuciaAuthGuard } from '../../common/guards/lucia-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Controller('disputes')
@UseGuards(LuciaAuthGuard, RolesGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  /**
   * Créer un litige (TESTEUR ou PRO)
   * POST /disputes/sessions/:id/dispute
   */
  @Post('sessions/:id/dispute')
  @Roles(UserRole.USER, UserRole.PRO)
  async createDispute(
    @Param('id') sessionId: string,
    @Body() dto: CreateDisputeDto,
    @Request() req: any,
  ) {
    return this.disputesService.createDispute(sessionId, req.user.userId, dto);
  }

  /**
   * Résoudre un litige (ADMIN uniquement)
   * POST /disputes/sessions/:id/resolve
   */
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

  /**
   * Liste des litiges (ADMIN)
   * GET /disputes?status=DISPUTED
   */
  @Get()
  @Roles(UserRole.ADMIN)
  async getDisputes(@Query('status') status?: string) {
    return this.disputesService.getDisputesByStatus(status);
  }

  /**
   * Détails d'un litige (ADMIN, TESTEUR ou PRO impliqué)
   * GET /disputes/sessions/:id
   */
  @Get('sessions/:id')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  async getDisputeDetails(
    @Param('id') sessionId: string,
    @Request() req: any,
  ) {
    return this.disputesService.getDisputeDetails(sessionId, req.user.userId);
  }
}
