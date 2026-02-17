import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';

@ApiTags('Withdrawals')
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @ApiOperation({ summary: 'Créer une demande de retrait' })
  @ApiResponse({ status: 201, description: 'Demande de retrait créée avec succès' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  @Post()
  @Roles(UserRole.PRO, UserRole.USER)
  async createWithdrawal(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.withdrawalsService.createWithdrawal(userId, dto.amount);
  }

  @ApiOperation({ summary: 'Récupérer mes retraits' })
  @ApiResponse({ status: 200, description: 'Liste des retraits récupérée avec succès' })
  @ApiAuthResponses()
  @Get('me')
  @Roles(UserRole.PRO, UserRole.USER)
  async getMyWithdrawals(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.withdrawalsService.getUserWithdrawals(userId, page, limit);
  }

  @ApiOperation({ summary: 'Récupérer un retrait par son identifiant' })
  @ApiResponse({ status: 200, description: 'Retrait récupéré avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @Get(':id')
  @Roles(UserRole.PRO, UserRole.USER)
  async getWithdrawal(
    @CurrentUser('id') userId: string,
    @Param('id') withdrawalId: string,
  ) {
    return this.withdrawalsService.getWithdrawal(withdrawalId, userId);
  }

  @ApiOperation({ summary: 'Annuler une demande de retrait' })
  @ApiResponse({ status: 201, description: 'Retrait annulé avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  @Post(':id/cancel')
  @Roles(UserRole.PRO, UserRole.USER)
  async cancelWithdrawal(
    @CurrentUser('id') userId: string,
    @Param('id') withdrawalId: string,
    @Body() dto: { reason: string },
  ) {
    return this.withdrawalsService.cancelWithdrawal(
      withdrawalId,
      userId,
      dto.reason,
    );
  }
}
