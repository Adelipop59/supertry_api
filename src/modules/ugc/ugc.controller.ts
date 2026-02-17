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
import { ApiTags, ApiOperation, ApiParam, ApiConsumes } from '@nestjs/swagger';
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
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('UGC')
@Controller('ugc')
export class UgcController {
  constructor(private readonly ugcService: UgcService) {}

  // ============================================================================
  // 1. POST /ugc/request — PRO demande un UGC
  // ============================================================================

  @Post('request')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Demander un UGC', description: 'Le vendeur (PRO) crée une demande de contenu UGC liée à une session' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Soumettre un UGC', description: 'Le testeur soumet son contenu UGC (multipart pour VIDEO/PHOTO, URL pour TEXT_REVIEW/EXTERNAL_REVIEW)' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiConsumes('multipart/form-data')
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Valider un UGC', description: 'Le vendeur valide le UGC soumis, ce qui déclenche la capture du paiement et le versement au testeur' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Rejeter un UGC', description: 'Le vendeur rejette le UGC soumis. Un litige est automatiquement ouvert après 3 rejets' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Décliner une demande UGC', description: 'Le testeur décline la demande UGC. Le PaymentIntent est annulé sans frais' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Annuler une demande UGC', description: 'Le vendeur annule sa demande UGC. Le PaymentIntent est annulé sans frais' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Ouvrir un litige UGC', description: 'Le vendeur ou le testeur escalade manuellement un UGC en litige' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
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
  @ApiOperation({ summary: 'Résoudre un litige UGC', description: 'L\'admin résout le litige UGC en payant le testeur, rejetant le UGC, ou accordant un paiement partiel' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Lister mes demandes UGC', description: 'Le vendeur récupère la liste de ses demandes UGC avec filtres et pagination' })
  @ApiAuthResponses()
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
  @ApiOperation({ summary: 'Lister mes soumissions UGC', description: 'Le testeur récupère la liste de ses soumissions UGC avec filtres et pagination' })
  @ApiAuthResponses()
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
  @ApiOperation({ summary: 'Lister les litiges UGC', description: 'L\'admin récupère la liste de tous les litiges UGC en cours' })
  @ApiAuthResponses()
  async getUgcDisputes() {
    return this.ugcService.getUgcDisputes();
  }

  // ============================================================================
  // 12. GET /ugc/session/:sessionId — UGCs d'une session
  // ============================================================================

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Lister les UGC d\'une session', description: 'Récupère tous les UGC liés à une session donnée' })
  @ApiParam({ name: 'sessionId', description: 'ID de la session', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
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
  @ApiOperation({ summary: 'Détail d\'un UGC', description: 'Récupère les détails d\'un UGC spécifique (vérification des droits d\'accès)' })
  @ApiParam({ name: 'id', description: 'ID du UGC', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getUgcDetail(
    @Param('id') ugcId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ugcService.getUgcDetail(ugcId, userId);
  }
}
