import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('pro-action-counts')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get pending action counts for PRO dashboard/sidebar badges',
  })
  @ApiResponse({ status: 200, description: 'Action counts by category' })
  @ApiAuthResponses()
  async getProActionCounts(@CurrentUser('id') userId: string) {
    return this.notificationsService.getProActionCounts(userId);
  }
}
