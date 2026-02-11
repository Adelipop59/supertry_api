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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  @Roles(UserRole.PRO, UserRole.USER)
  async createWithdrawal(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.withdrawalsService.createWithdrawal(userId, dto.amount);
  }

  @Get('me')
  @Roles(UserRole.PRO, UserRole.USER)
  async getMyWithdrawals(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.withdrawalsService.getUserWithdrawals(userId, page, limit);
  }

  @Get(':id')
  @Roles(UserRole.PRO, UserRole.USER)
  async getWithdrawal(
    @CurrentUser('id') userId: string,
    @Param('id') withdrawalId: string,
  ) {
    return this.withdrawalsService.getWithdrawal(withdrawalId, userId);
  }

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
