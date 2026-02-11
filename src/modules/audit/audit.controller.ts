import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditFilterDto } from './dto/audit-filter.dto';
import { CreateAuditDto } from './dto/create-audit.dto';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * POST /audit
   * Créer un log d'audit manuellement (ADMIN only - à sécuriser avec guard)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createAuditDto: CreateAuditDto) {
    await this.auditService.log(
      createAuditDto.userId || null,
      createAuditDto.category,
      createAuditDto.action,
      createAuditDto.details,
    );

    return {
      message: 'Audit log created successfully',
    };
  }

  /**
   * GET /audit
   * Liste tous les logs avec filtres et pagination (ADMIN only)
   */
  @Get()
  async findAll(@Query() filters: AuditFilterDto) {
    const { startDate, endDate, ...rest } = filters;

    return this.auditService.findAll({
      ...rest,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  /**
   * GET /audit/me
   * Récupère les logs de l'utilisateur connecté
   * TODO: Extraire userId du JWT via guard/decorator
   */
  @Get('me')
  async findMyLogs(@Query('userId') userId: string) {
    if (!userId) {
      return {
        message: 'User not authenticated',
        data: [],
      };
    }

    const logs = await this.auditService.findByUser(userId);
    return { data: logs };
  }

  /**
   * GET /audit/stats
   * Statistiques agrégées (ADMIN only)
   */
  @Get('stats')
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const dateRange = {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    };

    return this.auditService.getStats(dateRange);
  }

  /**
   * DELETE /audit/cleanup
   * Supprime les logs anciens (ADMIN only)
   */
  @Delete('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanup(@Query('days') days?: string) {
    const olderThanDays = days ? parseInt(days, 10) : 90;
    const deletedCount = await this.auditService.cleanup(olderThanDays);

    return {
      message: `Cleaned up ${deletedCount} audit logs older than ${olderThanDays} days`,
      deletedCount,
    };
  }
}
