import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AdminSystemService } from './admin-system.service';
import { MetricsService } from '../../common/services/metrics.service';

@ApiTags('Admin System')
@Controller('admin/system')
@Roles(UserRole.ADMIN)
export class AdminSystemController {
  constructor(
    private readonly adminSystemService: AdminSystemService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check etendu (DB, Redis, Stripe)' })
  @ApiAuthResponses()
  async getHealthCheck() {
    return this.adminSystemService.getHealthCheck();
  }

  @Get('info')
  @ApiOperation({ summary: 'Infos serveur temps reel (CPU, memoire, disque, reseau)' })
  @ApiAuthResponses()
  getSystemInfo() {
    return this.adminSystemService.getSystemInfo();
  }

  @Get('history')
  @ApiOperation({ summary: 'Historique systeme pour graphiques (CPU, RAM, disque, reseau)' })
  @ApiAuthResponses()
  getSystemHistory(
    @Query('period') period?: '1h' | '6h' | '24h' | '7d' | '30d',
  ) {
    return this.adminSystemService.getSystemHistory(period || '1h');
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Metriques API globales (all-time depuis dernier restart)' })
  @ApiAuthResponses()
  getApiMetrics() {
    return this.adminSystemService.getApiMetrics();
  }

  @Get('metrics/daily')
  @ApiOperation({ summary: 'Requetes par jour et par endpoint (30 derniers jours)' })
  @ApiAuthResponses()
  getDailyMetrics(
    @Query('days') days?: number,
  ) {
    return this.metricsService.getDailyMetrics(days ? Number(days) : 7);
  }

  @Get('metrics/hourly')
  @ApiOperation({ summary: 'Nombre de requetes par heure (dernieres 24h)' })
  @ApiAuthResponses()
  getHourlyMetrics() {
    return this.metricsService.getHourlyRequestCounts();
  }

  @Get('metrics/route')
  @ApiOperation({ summary: 'Detail d\'un endpoint specifique (all-time + par jour)' })
  @ApiAuthResponses()
  getRouteDetail(
    @Query('method') method: string,
    @Query('route') route: string,
  ) {
    return this.metricsService.getRouteDetail(method, route);
  }
}
