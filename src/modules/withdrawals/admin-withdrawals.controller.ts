import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { WithdrawalsService } from './withdrawals.service';
import { AdminListWithdrawalsQueryDto } from './dto/admin-list-withdrawals-query.dto';
import {
  ApiAuthResponses,
  ApiNotFoundErrorResponse,
  ApiValidationErrorResponse,
} from '../../common/decorators/api-error-responses.decorator';

@ApiTags('Admin / Withdrawals')
@Controller('admin/withdrawals')
@Roles(UserRole.ADMIN)
export class AdminWithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister tous les retraits avec pagination et filtres',
  })
  @ApiResponse({
    status: 200,
    description: 'Liste paginée des retraits',
    schema: {
      example: {
        data: [
          {
            id: 'uuid',
            amount: '150.00',
            method: 'BANK_TRANSFER',
            status: 'PENDING',
            createdAt: '2026-04-08T10:00:00.000Z',
            processedAt: null,
            user: {
              id: 'uuid',
              email: 'tester@example.com',
              firstName: 'Jane',
              lastName: 'Doe',
            },
          },
        ],
        meta: {
          total: 142,
          page: 1,
          limit: 20,
          totalPages: 8,
        },
      },
    },
  })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async list(@Query() query: AdminListWithdrawalsQueryDto) {
    return this.withdrawalsService.listForAdmin(query);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Rejeter une demande de retrait en attente' })
  @ApiResponse({ status: 200, description: 'Retrait rejeté avec succès' })
  @ApiResponse({ status: 404, description: 'Retrait non trouvé' })
  @ApiResponse({
    status: 400,
    description: 'Retrait non rejectable (status != PENDING)',
  })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async reject(
    @Param('id') withdrawalId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: { reason: string },
  ) {
    return this.withdrawalsService.rejectByAdmin(
      withdrawalId,
      adminId,
      dto.reason,
    );
  }
}
