import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TestSessionsService } from './test-sessions.service';
import { ApplyToCampaignDto } from './dto/apply-campaign.dto';
import { ValidatePriceDto } from './dto/validate-price.dto';
import { SubmitPurchaseDto } from './dto/submit-purchase.dto';
import { ValidatePurchaseDto } from './dto/validate-purchase.dto';
import { CompleteStepDto } from './dto/complete-step.dto';
import { CancelSessionDto } from './dto/cancel-session.dto';
import { RejectSessionDto } from './dto/reject-session.dto';
import { RejectPurchaseDto } from './dto/reject-purchase.dto';
import { TestSessionResponseDto } from './dto/test-session-response.dto';
import { TestSessionFilterDto } from './dto/test-session-filter.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@Controller('test-sessions')
export class TestSessionsController {
  constructor(private readonly testSessionsService: TestSessionsService) {}

  // USER (Testeur) endpoints
  @Post(':campaignId/apply')
  @Roles(UserRole.USER)
  @HttpCode(HttpStatus.CREATED)
  async apply(
    @Param('campaignId') campaignId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyToCampaignDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.apply(campaignId, userId, dto);
  }

  @Get('my-sessions')
  @Roles(UserRole.USER)
  async findMySessions(
    @CurrentUser('id') userId: string,
    @Query() filterDto: TestSessionFilterDto,
  ): Promise<PaginatedResponse<TestSessionResponseDto>> {
    return this.testSessionsService.findMySessions(userId, filterDto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<TestSessionResponseDto> {
    return this.testSessionsService.findOne(id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.USER)
  async cancel(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CancelSessionDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.cancel(id, userId, dto);
  }

  @Post(':id/validate-price')
  @Roles(UserRole.USER)
  async validatePrice(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ValidatePriceDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.validatePrice(id, userId, dto);
  }

  @Post(':id/submit-purchase')
  @Roles(UserRole.USER)
  async submitPurchase(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitPurchaseDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.submitPurchase(id, userId, dto);
  }

  @Post(':id/steps/:stepId/complete')
  @Roles(UserRole.USER)
  async completeStep(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CompleteStepDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.completeStep(id, stepId, userId, dto);
  }

  @Post(':id/submit-test')
  @Roles(UserRole.USER)
  async submitTest(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.submitTest(id, userId);
  }

  // PRO endpoints
  @Post(':id/accept')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async accept(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.accept(id, userId);
  }

  @Post(':id/reject')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async reject(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectSessionDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.reject(id, userId, dto);
  }

  @Post(':id/validate-purchase')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async validatePurchase(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ValidatePurchaseDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.validatePurchase(id, userId, dto);
  }

  @Post(':id/reject-purchase')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async rejectPurchase(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectPurchaseDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.rejectPurchase(id, userId, dto);
  }

  @Post(':id/complete')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async complete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.complete(id, userId);
  }
}
