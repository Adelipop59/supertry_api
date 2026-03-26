import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AdminSystemService } from './admin-system.service';

@ApiTags('Admin System')
@Controller('admin/system')
@Roles(UserRole.ADMIN)
export class AdminSystemController {
  constructor(private readonly adminSystemService: AdminSystemService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check etendu (DB, Redis, Stripe)' })
  @ApiAuthResponses()
  async getHealthCheck() {
    return this.adminSystemService.getHealthCheck();
  }

  @Get('info')
  @ApiOperation({ summary: 'Infos serveur temps reel (CPU, memoire, K8s)' })
  @ApiAuthResponses()
  getSystemInfo() {
    return this.adminSystemService.getSystemInfo();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Metriques API (temps de reponse, erreurs par route)' })
  @ApiAuthResponses()
  getApiMetrics() {
    return this.adminSystemService.getApiMetrics();
  }
}
