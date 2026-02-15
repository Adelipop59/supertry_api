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
import { RatingsService } from './ratings.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateTesterRatingDto } from './dto/create-tester-rating.dto';
import { RatingFilterDto } from './dto/rating-filter.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  // ============================================================================
  // TESTEUR → Product + Seller (Review)
  // ============================================================================

  @Post('review')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
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
  async getProductReviews(
    @Param('productId') productId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getProductReviews(productId, filterDto);
  }

  @Get('campaign/:campaignId')
  @Public()
  async getCampaignReviews(
    @Param('campaignId') campaignId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getCampaignReviews(campaignId, filterDto);
  }

  @Get('seller/:sellerId')
  @Public()
  async getSellerReviews(
    @Param('sellerId') sellerId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getSellerReviews(sellerId, filterDto);
  }

  @Get('tester/:testerId')
  @Public()
  async getTesterRatings(
    @Param('testerId') testerId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getTesterRatings(testerId, filterDto);
  }

  @Get('profile/:profileId/summary')
  @Public()
  async getProfileRatingSummary(@Param('profileId') profileId: string) {
    return this.ratingsService.getProfileRatingSummary(profileId);
  }

  // ============================================================================
  // GET — Authentifié
  // ============================================================================

  @Get('my-reviews')
  @Roles(UserRole.USER, UserRole.ADMIN)
  async getMyReviews(
    @CurrentUser('id') userId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getMyReviews(userId, filterDto);
  }

  @Get('my-tester-ratings')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async getMyTesterRatings(
    @CurrentUser('id') userId: string,
    @Query() filterDto: RatingFilterDto,
  ) {
    return this.ratingsService.getMyTesterRatings(userId, filterDto);
  }

  @Get('session/:sessionId/review')
  async getSessionReview(@Param('sessionId') sessionId: string) {
    return this.ratingsService.getSessionReview(sessionId);
  }

  @Get('session/:sessionId/tester-rating')
  async getSessionTesterRating(@Param('sessionId') sessionId: string) {
    return this.ratingsService.getSessionTesterRating(sessionId);
  }
}
