import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Get personalized dashboard data based on user role',
  })
  @ApiResponse({ status: 200, description: 'Dashboard data for the authenticated user' })
  @ApiAuthResponses()
  async getDashboard(@CurrentUser() user: any) {
    return this.dashboardService.getDashboard(user);
  }
}
