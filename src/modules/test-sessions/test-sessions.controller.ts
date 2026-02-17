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
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
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
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { UserRole } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@ApiTags('Test Sessions')
@Controller('test-sessions')
export class TestSessionsController {
  constructor(private readonly testSessionsService: TestSessionsService) {}

  // USER (Testeur) endpoints
  @Post(':campaignId/apply')
  @Roles(UserRole.USER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Postuler à une campagne de test' })
  @ApiResponse({ status: 201, description: 'Candidature créée avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Données invalides ou candidature déjà existante' })
  @ApiResponse({ status: 404, description: 'Campagne non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async apply(
    @Param('campaignId') campaignId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyToCampaignDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.apply(campaignId, userId, dto);
  }

  @Get('my-sessions')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Récupérer mes sessions de test en tant que testeur' })
  @ApiResponse({ status: 200, description: 'Liste paginée des sessions du testeur' })
  @ApiAuthResponses()
  async findMySessions(
    @CurrentUser('id') userId: string,
    @Query() filterDto: TestSessionFilterDto,
  ): Promise<PaginatedResponse<TestSessionResponseDto>> {
    return this.testSessionsService.findMySessions(userId, filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer les détails d\'une session de test' })
  @ApiResponse({ status: 200, description: 'Détails de la session de test', type: TestSessionResponseDto })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async findOne(@Param('id') id: string): Promise<TestSessionResponseDto> {
    return this.testSessionsService.findOne(id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Annuler une session de test en tant que testeur' })
  @ApiResponse({ status: 200, description: 'Session annulée avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Annulation impossible dans l\'état actuel' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async cancel(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CancelSessionDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.cancel(id, userId, dto);
  }

  @Post(':id/validate-price')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Valider le prix du produit avant achat' })
  @ApiResponse({ status: 200, description: 'Prix validé avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Prix invalide ou validation impossible' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async validatePrice(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ValidatePriceDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.validatePrice(id, userId, dto);
  }

  @Post(':id/submit-purchase')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Soumettre la preuve d\'achat du produit' })
  @ApiResponse({ status: 200, description: 'Preuve d\'achat soumise avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Données d\'achat invalides' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async submitPurchase(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitPurchaseDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.submitPurchase(id, userId, dto);
  }

  @Post(':id/steps/:stepId/complete')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Compléter une étape du test' })
  @ApiResponse({ status: 200, description: 'Étape complétée avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Données de soumission invalides' })
  @ApiResponse({ status: 404, description: 'Session ou étape non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
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
  @ApiOperation({ summary: 'Soumettre le test finalisé pour validation par le vendeur' })
  @ApiResponse({ status: 200, description: 'Test soumis avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Toutes les étapes ne sont pas complétées' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async submitTest(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.submitTest(id, userId);
  }

  // PRO endpoints
  @Post(':id/accept')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Accepter la candidature d\'un testeur (vendeur)' })
  @ApiResponse({ status: 200, description: 'Candidature acceptée avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Acceptation impossible dans l\'état actuel' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async accept(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.accept(id, userId);
  }

  @Post(':id/reject')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Rejeter la candidature d\'un testeur (vendeur)' })
  @ApiResponse({ status: 200, description: 'Candidature rejetée avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Rejet impossible dans l\'état actuel' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async reject(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectSessionDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.reject(id, userId, dto);
  }

  @Post(':id/validate-purchase')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Valider la preuve d\'achat soumise par le testeur (vendeur)' })
  @ApiResponse({ status: 200, description: 'Achat validé avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Validation impossible dans l\'état actuel' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async validatePurchase(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ValidatePurchaseDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.validatePurchase(id, userId, dto);
  }

  @Post(':id/reject-purchase')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Rejeter la preuve d\'achat soumise par le testeur (vendeur)' })
  @ApiResponse({ status: 200, description: 'Achat rejeté avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Rejet impossible dans l\'état actuel' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async rejectPurchase(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectPurchaseDto,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.rejectPurchase(id, userId, dto);
  }

  @Post(':id/complete')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Valider et compléter la session de test (vendeur)' })
  @ApiResponse({ status: 200, description: 'Session complétée avec succès', type: TestSessionResponseDto })
  @ApiResponse({ status: 400, description: 'Complétion impossible dans l\'état actuel' })
  @ApiResponse({ status: 404, description: 'Session non trouvée' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async complete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<TestSessionResponseDto> {
    return this.testSessionsService.complete(id, userId);
  }
}
