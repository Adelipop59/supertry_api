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
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { RatingsService } from './ratings.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateTesterRatingDto } from './dto/create-tester-rating.dto';
import { RatingFilterDto } from './dto/rating-filter.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Ratings')
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  // ============================================================================
  // TESTEUR → Product + Seller (Review)
  // ============================================================================

  @Post('review')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer un avis produit/vendeur', description: 'Le testeur laisse un avis sur le produit et le vendeur après une session' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async createReview(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.ratingsService.createReview(userId, dto);
  }

  // ============================================================================
  // PRO → Testeur (TesterRating)
  // ============================================================================

  @Post('tester')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Noter un testeur', description: 'Le vendeur note un testeur après une session' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async createTesterRating(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTesterRatingDto,
  ) {
    return this.ratingsService.createTesterRating(userId, dto);
  }

  // ============================================================================
  // GET — Public
  // ============================================================================

  @Get('product/:productId')
  @Public()
  @ApiOperation({ summary: 'Avis d\'un produit', description: 'Récupère les avis publics pour un produit donné' })
  @ApiParam({ name: 'productId', description: 'ID du produit', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiNotFoundErrorResponse()
  async getProductReviews(
    @Param('productId') productId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getProductReviews(productId, filterDto);
  }

  @Get('campaign/:campaignId')
  @Public()
  @ApiOperation({ summary: 'Avis d\'une campagne', description: 'Récupère les avis publics pour une campagne donnée' })
  @ApiParam({ name: 'campaignId', description: 'ID de la campagne', example: '550e8400-e29b-41d4-a716-446655440002' })
  @ApiNotFoundErrorResponse()
  async getCampaignReviews(
    @Param('campaignId') campaignId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getCampaignReviews(campaignId, filterDto);
  }

  @Get('seller/:sellerId')
  @Public()
  @ApiOperation({ summary: 'Avis d\'un vendeur', description: 'Récupère les avis publics pour un vendeur donné' })
  @ApiParam({ name: 'sellerId', description: 'ID du vendeur', example: '550e8400-e29b-41d4-a716-446655440003' })
  @ApiNotFoundErrorResponse()
  async getSellerReviews(
    @Param('sellerId') sellerId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getSellerReviews(sellerId, filterDto);
  }

  @Get('tester/:testerId')
  @Public()
  @ApiOperation({ summary: 'Notes d\'un testeur', description: 'Récupère les notes attribuées à un testeur' })
  @ApiParam({ name: 'testerId', description: 'ID du testeur', example: '550e8400-e29b-41d4-a716-446655440004' })
  @ApiNotFoundErrorResponse()
  async getTesterRatings(
    @Param('testerId') testerId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getTesterRatings(testerId, filterDto);
  }

  @Get('profile/:profileId/summary')
  @Public()
  @ApiOperation({ summary: 'Résumé des notes d\'un profil', description: 'Récupère le résumé agrégé des notes (moyenne, nombre) pour un profil' })
  @ApiParam({ name: 'profileId', description: 'ID du profil', example: '550e8400-e29b-41d4-a716-446655440005' })
  @ApiNotFoundErrorResponse()
  async getProfileRatingSummary(@Param('profileId') profileId: string) {
    return this.ratingsService.getProfileRatingSummary(profileId);
  }

  // ============================================================================
  // GET — Authentifié
  // ============================================================================

  @Get('my-reviews')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Mes avis', description: 'Le testeur récupère la liste de ses propres avis avec filtres et pagination' })
  @ApiAuthResponses()
  async getMyReviews(
    @CurrentUser('id') userId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getMyReviews(userId, filterDto);
  }

  @Get('my-tester-ratings')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Mes notes de testeurs', description: 'Le vendeur récupère la liste des notes qu\'il a attribuées aux testeurs' })
  @ApiAuthResponses()
  async getMyTesterRatings(
    @CurrentUser('id') userId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getMyTesterRatings(userId, filterDto);
  }

  @Get('session/:sessionId/review')
  @ApiOperation({ summary: 'Avis d\'une session', description: 'Récupère l\'avis (review) lié à une session spécifique' })
  @ApiParam({ name: 'sessionId', description: 'ID de la session', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getSessionReview(@Param('sessionId') sessionId: string) {
    return this.ratingsService.getSessionReview(sessionId);
  }

  @Get('session/:sessionId/tester-rating')
  @ApiOperation({ summary: 'Note testeur d\'une session', description: 'Récupère la note du testeur liée à une session spécifique' })
  @ApiParam({ name: 'sessionId', description: 'ID de la session', example: '550e8400-e29b-41d4-a716-446655440001' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getSessionTesterRating(@Param('sessionId') sessionId: string) {
    return this.ratingsService.getSessionTesterRating(sessionId);
  }
}
