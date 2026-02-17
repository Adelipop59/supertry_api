import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SessionStatus, AuditCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createPaginatedResponse, PaginatedResponse } from '../../common/dto/pagination.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateTesterRatingDto } from './dto/create-tester-rating.dto';
import { RatingFilterDto } from './dto/rating-filter.dto';

const REVIEW_INCLUDE = {
  session: { select: { id: true, status: true, campaignId: true, testerId: true } },
  campaign: { select: { id: true, title: true, sellerId: true } },
  product: { select: { id: true, name: true } },
  tester: { select: { id: true, firstName: true, lastName: true, avatar: true } },
};

const TESTER_RATING_INCLUDE = {
  session: { select: { id: true, status: true, campaignId: true } },
  rater: { select: { id: true, firstName: true, lastName: true } },
  tester: { select: { id: true, firstName: true, lastName: true, avatar: true, averageRating: true } },
};

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ============================================================================
  // TESTEUR → Product + Seller (Review)
  // ============================================================================

  async createReview(userId: string, dto: CreateReviewDto) {
    // 1. Vérifier la session
    const session = await this.prisma.testSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        campaign: {
          select: {
            id: true,
            title: true,
            sellerId: true,
            offers: { select: { productId: true }, take: 1 },
          },
        },
      },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.testerId !== userId) {
      throw new ForbiddenException('You can only review sessions you participated in');
    }
    if (session.status !== SessionStatus.COMPLETED) {
      throw new BadRequestException('Can only review completed sessions');
    }

    // 2. Vérifier pas de doublon
    const existing = await this.prisma.review.findUnique({
      where: { sessionId: dto.sessionId },
    });
    if (existing) {
      throw new BadRequestException('You already reviewed this session');
    }

    // 3. Récupérer le productId depuis l'offre
    const productId = session.campaign.offers?.[0]?.productId;
    if (!productId) {
      throw new NotFoundException('No product found for this campaign');
    }

    // 4. Créer la review
    const review = await this.prisma.review.create({
      data: {
        sessionId: dto.sessionId,
        campaignId: session.campaign.id,
        productId,
        testerId: userId,
        productRating: dto.productRating,
        sellerRating: dto.sellerRating,
        comment: dto.comment,
        isPublic: dto.isPublic ?? true,
      },
      include: REVIEW_INCLUDE,
    });

    // 5. Mettre à jour averageRating du PRO (seller)
    await this.updateSellerAverageRating(session.campaign.sellerId);

    // 6. Audit
    await this.auditService.log(userId, AuditCategory.SESSION, 'REVIEW_CREATED', {
      reviewId: review.id,
      sessionId: dto.sessionId,
      campaignId: session.campaign.id,
      productRating: dto.productRating,
      sellerRating: dto.sellerRating,
    });

    this.logger.log(`Review created: ${review.id} for session ${dto.sessionId}`);
    return review;
  }

  // ============================================================================
  // PRO → Testeur (TesterRating)
  // ============================================================================

  async createTesterRating(userId: string, dto: CreateTesterRatingDto) {
    // 1. Vérifier la session
    const session = await this.prisma.testSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        campaign: { select: { id: true, sellerId: true, title: true } },
        tester: { select: { id: true, firstName: true, email: true } },
      },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.campaign.sellerId !== userId) {
      throw new ForbiddenException('You can only rate testers on your own campaigns');
    }
    if (session.status !== SessionStatus.COMPLETED) {
      throw new BadRequestException('Can only rate testers on completed sessions');
    }

    // 2. Vérifier pas de doublon
    const existing = await this.prisma.testerRating.findUnique({
      where: { sessionId: dto.sessionId },
    });
    if (existing) {
      throw new BadRequestException('You already rated the tester for this session');
    }

    // 3. Créer le rating
    const testerRating = await this.prisma.testerRating.create({
      data: {
        sessionId: dto.sessionId,
        raterId: userId,
        testerId: session.testerId,
        rating: dto.rating,
        comment: dto.comment,
      },
      include: TESTER_RATING_INCLUDE,
    });

    // 4. Mettre à jour averageRating du testeur
    await this.updateTesterAverageRating(session.testerId);

    // 5. Audit
    await this.auditService.log(userId, AuditCategory.SESSION, 'TESTER_RATED', {
      testerRatingId: testerRating.id,
      sessionId: dto.sessionId,
      testerId: session.testerId,
      rating: dto.rating,
    });

    this.logger.log(`Tester rated: ${session.testerId} → ${dto.rating}/5 on session ${dto.sessionId}`);
    return testerRating;
  }

  // ============================================================================
  // GET ENDPOINTS
  // ============================================================================

  /** Reviews d'un produit (public) */
  async getProductReviews(productId: string, filterDto: RatingFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { productId, isPublic: true };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.count({ where }),
    ]);

    return createPaginatedResponse(reviews, total, page, limit);
  }

  /** Reviews d'une campagne (public) */
  async getCampaignReviews(campaignId: string, filterDto: RatingFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { campaignId, isPublic: true };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.count({ where }),
    ]);

    return createPaginatedResponse(reviews, total, page, limit);
  }

  /** Reviews du PRO (seller) — toutes les reviews reçues */
  async getSellerReviews(sellerId: string, filterDto: RatingFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = {
      campaign: { sellerId },
      isPublic: true,
    };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.count({ where }),
    ]);

    return createPaginatedResponse(reviews, total, page, limit);
  }

  /** Ratings d'un testeur (reçus du PRO) */
  async getTesterRatings(testerId: string, filterDto: RatingFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { testerId };

    const [ratings, total] = await Promise.all([
      this.prisma.testerRating.findMany({
        where,
        skip,
        take: limit,
        include: TESTER_RATING_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.testerRating.count({ where }),
    ]);

    return createPaginatedResponse(ratings, total, page, limit);
  }

  /** Mes reviews (testeur) */
  async getMyReviews(userId: string, filterDto: RatingFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { testerId: userId };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.count({ where }),
    ]);

    return createPaginatedResponse(reviews, total, page, limit);
  }

  /** Mes ratings donnés aux testeurs (PRO) */
  async getMyTesterRatings(userId: string, filterDto: RatingFilterDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { raterId: userId };

    const [ratings, total] = await Promise.all([
      this.prisma.testerRating.findMany({
        where,
        skip,
        take: limit,
        include: TESTER_RATING_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.testerRating.count({ where }),
    ]);

    return createPaginatedResponse(ratings, total, page, limit);
  }

  /** Moyenne d'un profil (seller ou tester) */
  async getProfileRatingSummary(profileId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true, role: true, averageRating: true },
    });

    if (!profile) throw new NotFoundException('Profile not found');

    if (profile.role === 'PRO') {
      // Moyenne des sellerRatings reçus
      const agg = await this.prisma.review.aggregate({
        where: { campaign: { sellerId: profileId } },
        _avg: { sellerRating: true },
        _count: { id: true },
      });
      return {
        profileId,
        role: 'PRO',
        averageRating: agg._avg.sellerRating ?? 0,
        totalRatings: agg._count.id,
      };
    } else {
      // Moyenne des testerRatings reçus
      const agg = await this.prisma.testerRating.aggregate({
        where: { testerId: profileId },
        _avg: { rating: true },
        _count: { id: true },
      });
      return {
        profileId,
        role: 'TESTER',
        averageRating: agg._avg.rating ?? 0,
        totalRatings: agg._count.id,
      };
    }
  }

  /** Review d'une session spécifique */
  async getSessionReview(sessionId: string) {
    const review = await this.prisma.review.findUnique({
      where: { sessionId },
      include: REVIEW_INCLUDE,
    });
    return review;
  }

  /** TesterRating d'une session spécifique */
  async getSessionTesterRating(sessionId: string) {
    const rating = await this.prisma.testerRating.findUnique({
      where: { sessionId },
      include: TESTER_RATING_INCLUDE,
    });
    return rating;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async updateSellerAverageRating(sellerId: string) {
    const agg = await this.prisma.review.aggregate({
      where: { campaign: { sellerId } },
      _avg: { sellerRating: true },
    });

    const avg = agg._avg.sellerRating ?? 0;
    await this.prisma.profile.update({
      where: { id: sellerId },
      data: { averageRating: new Decimal(avg) },
    });

    this.logger.log(`Seller ${sellerId} averageRating updated to ${avg}`);
  }

  private async updateTesterAverageRating(testerId: string) {
    const agg = await this.prisma.testerRating.aggregate({
      where: { testerId },
      _avg: { rating: true },
    });

    const avg = agg._avg.rating ?? 0;
    await this.prisma.profile.update({
      where: { id: testerId },
      data: { averageRating: new Decimal(avg) },
    });

    this.logger.log(`Tester ${testerId} averageRating updated to ${avg}`);
  }
}
