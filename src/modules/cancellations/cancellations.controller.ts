import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CancellationsService } from './cancellations.service';
import { LuciaAuthGuard } from '../../common/guards/lucia-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CancelCampaignDto } from './dto/cancel-campaign.dto';

@Controller('cancellations')
@UseGuards(LuciaAuthGuard, RolesGuard)
export class CancellationsController {
  constructor(private readonly cancellationsService: CancellationsService) {}

  /**
   * PRO annule sa campagne
   * POST /cancellations/campaigns/:id/cancel
   */
  @Post('campaigns/:id/cancel')
  @Roles(UserRole.PRO)
  async cancelCampaign(
    @Param('id') campaignId: string,
    @Body() dto: CancelCampaignDto,
    @Request() req: any,
  ) {
    return this.cancellationsService.cancelCampaignByPro(
      campaignId,
      req.user.userId,
      dto,
    );
  }

  /**
   * ADMIN annule une campagne
   * POST /cancellations/campaigns/:id/admin-cancel
   */
  @Post('campaigns/:id/admin-cancel')
  @Roles(UserRole.ADMIN)
  async adminCancelCampaign(
    @Param('id') campaignId: string,
    @Body() dto: CancelCampaignDto,
    @Request() req: any,
  ) {
    return this.cancellationsService.cancelCampaignByAdmin(
      campaignId,
      req.user.userId,
      dto,
    );
  }

  /**
   * Aperçu des impacts d'annulation
   * GET /cancellations/campaigns/:id/impact
   */
  @Get('campaigns/:id/impact')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async getCancellationImpact(
    @Param('id') campaignId: string,
    @Request() req: any,
  ) {
    return this.cancellationsService.calculateCancellationImpact(
      campaignId,
      req.user.userId,
    );
  }
}
