import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ApiAuthResponses,
  ApiNotFoundErrorResponse,
  ApiValidationErrorResponse,
} from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { AdminModerationService } from './admin-moderation.service';

@ApiTags('Admin Users')
@Controller('admin/users')
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(
    private readonly adminModerationService: AdminModerationService,
  ) {}

  @Get('flagged')
  @ApiOperation({ summary: 'Lister les utilisateurs avec incohérence de vérification' })
  @ApiResponse({ status: 200, description: 'Liste paginée des utilisateurs flaggés' })
  @ApiAuthResponses()
  async listFlaggedUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminModerationService.listFlaggedUsers(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get(':id/verification-details')
  @ApiOperation({ summary: 'Détails de vérification d\'un utilisateur' })
  @ApiResponse({ status: 200, description: 'Détails de vérification' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getVerificationDetails(@Param('id') userId: string) {
    return this.adminModerationService.getVerificationDetails(userId);
  }

  @Post(':id/resolve-verification')
  @ApiOperation({ summary: 'Résoudre une incohérence de vérification (admin)' })
  @ApiResponse({ status: 201, description: 'Incohérence résolue' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async resolveVerification(
    @Param('id') userId: string,
    @CurrentUser('id') adminId: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; reason?: string },
  ) {
    return this.adminModerationService.resolveVerification(userId, adminId, body);
  }
}
