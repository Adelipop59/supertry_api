import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CancellationsService } from './cancellations.service';
import { LuciaAuthGuard } from '../../common/guards/lucia-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CancelCampaignDto } from './dto/cancel-campaign.dto';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';

@ApiTags('Cancellations')
@Controller('cancellations')
@UseGuards(LuciaAuthGuard, RolesGuard)
export class CancellationsController {
  constructor(private readonly cancellationsService: CancellationsService) {}

  @ApiOperation({ summary: 'Annuler une campagne (PRO)' })
  @ApiResponse({ status: 200, description: 'Campagne annulée avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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

  @ApiOperation({ summary: 'Annuler une campagne (ADMIN)' })
  @ApiResponse({ status: 200, description: 'Campagne annulée avec succès par l\'administrateur' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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

  @ApiOperation({ summary: 'Aperçu des impacts d\'annulation d\'une campagne' })
  @ApiResponse({ status: 200, description: 'Détails des impacts d\'annulation' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
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
