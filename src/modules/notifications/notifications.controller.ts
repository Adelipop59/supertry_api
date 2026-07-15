import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
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

  @Get()
  @ApiOperation({ summary: "List the current user's in-app notifications" })
  @ApiResponse({ status: 200, description: 'Notifications, newest first' })
  @ApiAuthResponses()
  async list(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 100);
    return this.notificationsService.getNotificationHistory(userId, take);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications for the current user' })
  @ApiResponse({ status: 200, description: 'Unread count' })
  @ApiAuthResponses()
  async unreadCount(@CurrentUser('id') userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all of the current user notifications as read' })
  @ApiResponse({ status: 200, description: 'Number of notifications updated' })
  @ApiAuthResponses()
  async markAllRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiResponse({ status: 200, description: 'Number of notifications updated' })
  @ApiAuthResponses()
  async markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markAsRead(userId, id);
  }

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
