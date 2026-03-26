import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiAuthResponses, ApiNotFoundErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AdminOverviewService } from './admin-overview.service';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { AdminCampaignsQueryDto } from './dto/admin-campaigns-query.dto';
import { AdminProductsQueryDto } from './dto/admin-products-query.dto';

@ApiTags('Admin Overview')
@Controller('admin/overview')
@Roles(UserRole.ADMIN)
export class AdminOverviewController {
  constructor(private readonly adminOverviewService: AdminOverviewService) {}

  // ============================================================================
  // Users
  // ============================================================================

  @Get('users')
  @ApiOperation({ summary: 'Liste paginee de tous les utilisateurs' })
  @ApiAuthResponses()
  async listUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminOverviewService.listUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Detail complet d\'un utilisateur' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getUserDetail(@Param('id') userId: string) {
    return this.adminOverviewService.getUserDetail(userId);
  }

  // ============================================================================
  // Campaigns
  // ============================================================================

  @Get('campaigns')
  @ApiOperation({ summary: 'Liste paginee de toutes les campagnes' })
  @ApiAuthResponses()
  async listCampaigns(@Query() query: AdminCampaignsQueryDto) {
    return this.adminOverviewService.listCampaigns(query);
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Detail complet d\'une campagne' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getCampaignDetail(@Param('id') campaignId: string) {
    return this.adminOverviewService.getCampaignDetail(campaignId);
  }

  // ============================================================================
  // Products
  // ============================================================================

  @Get('products')
  @ApiOperation({ summary: 'Liste paginee de tous les produits' })
  @ApiAuthResponses()
  async listProducts(@Query() query: AdminProductsQueryDto) {
    return this.adminOverviewService.listProducts(query);
  }

  // ============================================================================
  // Global Stats
  // ============================================================================

  @Get('global-stats')
  @ApiOperation({ summary: 'KPIs globaux: depenses, marges, croissance, conversion' })
  @ApiAuthResponses()
  async getGlobalStats() {
    return this.adminOverviewService.getGlobalStats();
  }
}
