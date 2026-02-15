import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UgcService } from './ugc.service';
import { CreateUgcRequestDto } from './dto/create-ugc-request.dto';
import { SubmitUgcDto } from './dto/submit-ugc.dto';
import { ValidateUgcDto } from './dto/validate-ugc.dto';
import { RejectUgcDto } from './dto/reject-ugc.dto';
import { DeclineUgcDto } from './dto/decline-ugc.dto';
import { CancelUgcDto } from './dto/cancel-ugc.dto';
import { ResolveUgcDisputeDto } from './dto/resolve-ugc-dispute.dto';
import { UgcFilterDto } from './dto/ugc-filter.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('ugc')
export class UgcController {
  constructor(private readonly ugcService: UgcService) {}

  // ============================================================================
  // 1. POST /ugc/request — PRO demande un UGC
  // ============================================================================

  @Post('request')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async requestUgc(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateUgcRequestDto,
  ) {
    return this.ugcService.requestUgc(userId, dto);
  }

  // ============================================================================
  // 2. POST /ugc/:id/submit — Testeur soumet un UGC (multipart pour VIDEO/PHOTO)
  // ============================================================================

  @Post(':id/submit')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async submitUgc(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitUgcDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.ugcService.submitUgc(ugcId, userId, dto, file);
  }

  // ============================================================================
  // 3. POST /ugc/:id/validate — PRO valide → capture PI → paiement testeur
  // ============================================================================

  @Post(':id/validate')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async validateUgc(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ValidateUgcDto,
  ) {
    return this.ugcService.validateUgc(ugcId, userId, dto);
  }

  // ============================================================================
  // 4. POST /ugc/:id/reject — PRO rejette (auto-dispute si 3 rejets)
  // ============================================================================

  @Post(':id/reject')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async rejectUgc(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectUgcDto,
  ) {
    return this.ugcService.rejectUgc(ugcId, userId, dto);
  }

  // ============================================================================
  // 5. POST /ugc/:id/decline — Testeur décline la demande → cancel PI (0 frais)
  // ============================================================================

  @Post(':id/decline')
  @Roles(UserRole.USER, UserRole.ADMIN)
  async declineUgc(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: DeclineUgcDto,
  ) {
    return this.ugcService.declineUgc(ugcId, userId, dto);
  }

  // ============================================================================
  // 6. POST /ugc/:id/cancel — PRO annule la demande → cancel PI (0 frais)
  // ============================================================================

  @Post(':id/cancel')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async cancelUgc(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CancelUgcDto,
  ) {
    return this.ugcService.cancelUgc(ugcId, userId, dto);
  }

  // ============================================================================
  // 7. POST /ugc/:id/dispute — Escalade manuelle en litige (PRO ou testeur)
  // ============================================================================

  @Post(':id/dispute')
  async createUgcDispute(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ugcService.createUgcDispute(ugcId, userId);
  }

  // ============================================================================
  // 8. POST /ugc/:id/resolve-dispute — Admin résout le litige
  // ============================================================================

  @Post(':id/resolve-dispute')
  @Roles(UserRole.ADMIN)
  async resolveUgcDispute(
    @Param('id') ugcId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: ResolveUgcDisputeDto,
  ) {
    return this.ugcService.resolveUgcDispute(ugcId, adminId, dto);
  }

  // ============================================================================
  // 9. GET /ugc/my-requests — PRO liste ses demandes UGC
  // ============================================================================

  @Get('my-requests')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async getMyRequests(
    @CurrentUser('id') userId: string,
    @Query() filterDto: UgcFilterDto,
  ) {
    return this.ugcService.getMyRequests(userId, filterDto);
  }

  // ============================================================================
  // 10. GET /ugc/my-submissions — Testeur liste ses soumissions UGC
  // ============================================================================

  @Get('my-submissions')
  @Roles(UserRole.USER, UserRole.ADMIN)
  async getMySubmissions(
    @CurrentUser('id') userId: string,
    @Query() filterDto: UgcFilterDto,
  ) {
    return this.ugcService.getMySubmissions(userId, filterDto);
  }

  // ============================================================================
  // 11. GET /ugc/disputes — Admin liste les litiges UGC
  // ============================================================================

  @Get('disputes')
  @Roles(UserRole.ADMIN)
  async getUgcDisputes() {
    return this.ugcService.getUgcDisputes();
  }

  // ============================================================================
  // 12. GET /ugc/session/:sessionId — UGCs d'une session
  // ============================================================================

  @Get('session/:sessionId')
  async getSessionUgcs(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ugcService.getSessionUgcs(sessionId, userId);
  }

  // ============================================================================
  // 13. GET /ugc/:id — Détail d'un UGC (vérif accès)
  // ============================================================================

  @Get(':id')
  async getUgcDetail(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ugcService.getUgcDetail(ugcId, userId);
  }
}
