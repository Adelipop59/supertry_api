import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiAuthResponses,
  ApiNotFoundErrorResponse,
  ApiValidationErrorResponse,
} from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { AdminModerationService } from './admin-moderation.service';
import { CreditTesterMaxDto } from './dto/credit-tester-max.dto';
import { RequestDocumentsDto } from './dto/request-documents.dto';
import { AdminSessionFilterDto } from './dto/admin-session-filter.dto';

@ApiTags('Admin Moderation')
@Controller('admin/sessions')
@Roles(UserRole.ADMIN)
export class AdminModerationController {
  constructor(
    private readonly adminModerationService: AdminModerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lister les sessions avec filtres (admin)' })
  @ApiResponse({ status: 200, description: 'Liste paginée des sessions' })
  @ApiAuthResponses()
  async listSessions(@Query() filter: AdminSessionFilterDto) {
    return this.adminModerationService.listSessions(filter);
  }

  @Get(':id/financial-summary')
  @ApiOperation({ summary: 'Résumé financier d\'une session' })
  @ApiResponse({ status: 200, description: 'Résumé financier détaillé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getFinancialSummary(@Param('id') sessionId: string) {
    return this.adminModerationService.getSessionFinancialSummary(sessionId);
  }

  @Post(':id/credit-tester-max')
  @ApiOperation({ summary: 'Créditer le testeur du montant maximum (override admin)' })
  @ApiResponse({ status: 201, description: 'Testeur crédité avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async creditTesterMax(
    @Param('id') sessionId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: CreditTesterMaxDto,
  ) {
    return this.adminModerationService.creditTesterMax(sessionId, adminId, dto);
  }

  @Post(':id/request-documents')
  @ApiOperation({ summary: 'Demander des documents au testeur ou PRO' })
  @ApiResponse({ status: 201, description: 'Demande de documents envoyée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async requestDocuments(
    @Param('id') sessionId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: RequestDocumentsDto,
  ) {
    return this.adminModerationService.requestDocuments(sessionId, adminId, dto);
  }

  @Post(':id/upload-documents')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Uploader des documents en réponse à une demande admin' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Documents uploadés avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadDocuments(
    @Param('id') sessionId: string,
    @CurrentUser('id') userId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.adminModerationService.uploadDisputeDocuments(
      sessionId,
      userId,
      files,
    );
  }
}
