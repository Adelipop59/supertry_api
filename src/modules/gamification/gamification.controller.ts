import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { GamificationService } from './gamification.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';
import { AdminAdjustXpDto } from './dto/admin-adjust-xp.dto';
import { XpHistoryFilterDto } from './dto/xp-history-filter.dto';

@ApiTags('Gamification')
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Get('dashboard')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Dashboard XP du testeur connecté' })
  @ApiResponse({ status: 200, description: 'Dashboard XP' })
  @ApiAuthResponses()
  async getDashboard(@CurrentUser('id') userId: string) {
    return this.gamificationService.getDashboard(userId);
  }

  @Get('history')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Historique des événements XP' })
  @ApiResponse({ status: 200, description: 'Historique XP paginé' })
  @ApiAuthResponses()
  async getHistory(
    @CurrentUser('id') userId: string,
    @Query() filterDto: XpHistoryFilterDto,
  ) {
    return this.gamificationService.getXpHistory(userId, filterDto);
  }

  @Get('tiers')
  @Public()
  @ApiOperation({ summary: 'Liste des paliers avec seuils et prix max' })
  @ApiResponse({ status: 200, description: 'Informations sur les paliers' })
  async getTiers() {
    return this.gamificationService.getTiersInfo();
  }

  @Post('admin/adjust-xp')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ajustement XP manuel (admin)' })
  @ApiResponse({ status: 200, description: 'XP ajusté' })
  @ApiAuthResponses()
  async adjustXp(
    @CurrentUser('id') adminId: string,
    @Body() dto: AdminAdjustXpDto,
  ) {
    await this.gamificationService.adminAdjustXp(
      adminId,
      dto.testerId,
      dto.amount,
      dto.reason,
    );
    return { message: 'XP ajusté avec succès' };
  }

  @Post('admin/backfill')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Backfill XP pour les testeurs existants' })
  @ApiResponse({ status: 200, description: 'Backfill terminé' })
  @ApiAuthResponses()
  async backfill() {
    return this.gamificationService.backfillExistingTesters();
  }
}
