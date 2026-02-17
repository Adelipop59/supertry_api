import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiAuthResponses, ApiNotFoundErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AdminFinanceService } from './admin-finance.service';
import { BalanceTransactionsQueryDto } from './dto/balance-transactions-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';
import { CampaignBreakdownResponseDto } from './dto/campaign-breakdown-response.dto';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import { RevenueResponseDto } from './dto/revenue-response.dto';

@ApiTags('Admin Finance')
@Controller('admin/finance')
@Roles(UserRole.ADMIN)
export class AdminFinanceController {
  constructor(private readonly adminFinanceService: AdminFinanceService) {}

  // ============================================================================
  // Option 2: Balance Transactions Stripe
  // ============================================================================

  @Get('stripe-transactions')
  @ApiOperation({ summary: 'Balance transactions Stripe enrichies avec données locales' })
  @ApiAuthResponses()
  async listBalanceTransactions(@Query() query: BalanceTransactionsQueryDto) {
    return this.adminFinanceService.listBalanceTransactions(query);
  }

  @Get('stripe-balance')
  @ApiOperation({ summary: 'Balance plateforme Stripe (available + pending)' })
  @ApiAuthResponses()
  async getStripeBalance() {
    return this.adminFinanceService.getStripeBalance();
  }

  // ============================================================================
  // Option 3: Dashboard financier
  // ============================================================================

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard financier: KPIs, commissions, escrow' })
  @ApiResponse({ status: 200, type: DashboardResponseDto })
  @ApiAuthResponses()
  async getDashboard(
    @Query('period') period?: 'day' | 'week' | 'month',
  ): Promise<DashboardResponseDto> {
    return this.adminFinanceService.getDashboard(period || 'month');
  }

  @Get('campaigns/:id/breakdown')
  @ApiOperation({ summary: 'Breakdown financier par campagne (P&L, transactions)' })
  @ApiResponse({ status: 200, type: CampaignBreakdownResponseDto })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getCampaignBreakdown(
    @Param('id') campaignId: string,
  ): Promise<CampaignBreakdownResponseDto> {
    return this.adminFinanceService.getCampaignBreakdown(campaignId);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Revenue par période avec breakdown par type' })
  @ApiResponse({ status: 200, type: RevenueResponseDto })
  @ApiAuthResponses()
  async getRevenue(@Query() query: RevenueQueryDto): Promise<RevenueResponseDto> {
    return this.adminFinanceService.getRevenue(query);
  }
}
