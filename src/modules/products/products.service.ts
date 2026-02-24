import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MediaService, MediaFolder, MediaType } from '../media/media.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductFilterDto } from './dto/product-filter.dto';
import { AddImagesDto } from './dto/add-images.dto';
import { RemoveImagesDto } from './dto/remove-images.dto';
import {
  PaginatedResponse,
  createPaginatedResponse,
} from '../../common/dto/pagination.dto';

const PRODUCT_INCLUDE = {
  seller: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      avatar: true,
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  offers: {
    select: {
      id: true,
      campaign: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private mediaService: MediaService,
  ) {}

  private async toResponseDto(product: any): Promise<ProductResponseDto> {
    const imageEntries: string[] = Array.isArray(product.images) ? product.images : [];

    // Convertir toutes les entrées en keys S3 si nécessaire, puis générer des signed URLs
    const keysToSign = imageEntries.map((entry) => {
      if (entry.startsWith('http://') || entry.startsWith('https://')) {
        // Ancienne URL complète -> extraire la key S3
        return this.mediaService.extractKeyFromUrl(entry) ?? entry;
      }
      return entry;
    });

    const signedImages = keysToSign.length > 0
      ? await this.mediaService.getSignedUrls(keysToSign)
      : [];

    return {
      ...product,
      price: Number(product.price),
      shippingCost: Number(product.shippingCost),
      images: signedImages,
      description: product.description ?? undefined,
      asin: product.asin ?? undefined,
      productUrl: product.productUrl ?? undefined,
      seller: product.seller ? {
        ...product.seller,
        firstName: product.seller.firstName ?? '',
        lastName: product.seller.lastName ?? '',
        companyName: product.seller.companyName ?? undefined,
        avatar: product.seller.avatar ?? undefined,
      } : undefined,
      category: product.category ?? undefined,
      offers: product.offers ?? undefined,
    };
  }

  async create(
    sellerId: string,
    createProductDto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    const { images = [], ...productData } = createProductDto;

    const product = await this.prisma.product.create({
      data: {
        ...productData,
        sellerId,
        images,
      },
      include: PRODUCT_INCLUDE,
    });

    return this.toResponseDto(product);
  }

  async findAll(
    filterDto: ProductFilterDto,
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    const { page = 1, limit = 10, categoryId, search, minPrice, maxPrice } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = {
      isActive: true,
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) {
        where.price.gte = minPrice;
      }
      if (maxPrice !== undefined) {
        where.price.lte = maxPrice;
      }
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: {
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              avatar: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    const mappedProducts = await Promise.all(products.map((p) => this.toResponseDto(p)));
    return createPaginatedResponse(mappedProducts, total, page, limit);
  }

  async findMyProducts(
    sellerId: string,
    filterDto: ProductFilterDto,
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    const { page = 1, limit = 10, categoryId, search } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = {
      sellerId,
      isActive: true,
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: {
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              avatar: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    const mappedProducts = await Promise.all(products.map((p) => this.toResponseDto(p)));
    return createPaginatedResponse(mappedProducts, total, page, limit);
  }

  async findOne(id: string, userId?: string, role?: string): Promise<ProductResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });

    if (!product) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }

    // Testers can only see products from campaigns they participated in
    if (role === UserRole.USER && userId) {
      const hasAccess = await this.prisma.testSession.findFirst({
        where: {
          testerId: userId,
          campaign: {
            offers: {
              some: { productId: id },
            },
          },
        },
      });

      if (!hasAccess) {
        throw new ForbiddenException('You can only view products from campaigns you participated in');
      }
    }

    return this.toResponseDto(product);
  }

  async update(
    id: string,
    sellerId: string,
    updateProductDto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    const product = await this.findOne(id);

    // Check ownership
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('You can only update your own products');
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: updateProductDto,
      include: PRODUCT_INCLUDE,
    });

    return this.toResponseDto(updatedProduct);
  }

  async remove(id: string, sellerId: string): Promise<{ type: 'soft' | 'hard' }> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        offers: {
          include: { campaign: { select: { status: true } } },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }

    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('You can only delete your own products');
    }

    // Bloquer si le produit est dans une campagne active
    const activeCampaignStatuses = ['DRAFT', 'PENDING_PAYMENT', 'PENDING_ACTIVATION', 'ACTIVE'];
    const hasActiveCampaign = product.offers.some(
      (offer: any) => activeCampaignStatuses.includes(offer.campaign.status),
    );

    if (hasActiveCampaign) {
      throw new ForbiddenException(
        'Ce produit est utilisé dans une campagne en cours. Terminez ou annulez la campagne avant de supprimer le produit.',
      );
    }

    const hasAnyCampaign = product.offers.length > 0;

    if (hasAnyCampaign) {
      // Soft delete : le produit a servi dans des campagnes (COMPLETED/CANCELLED),
      // on garde les données pour l'historique
      await this.prisma.product.update({
        where: { id },
        data: { isActive: false },
      });
      return { type: 'soft' };
    } else {
      // Hard delete : le produit n'a jamais été utilisé dans aucune campagne
      const imageEntries = (Array.isArray(product.images) ? product.images : []) as string[];
      if (imageEntries.length > 0) {
        const keys = imageEntries.map((entry) => {
          if (entry.startsWith('http://') || entry.startsWith('https://')) {
            return this.mediaService.extractKeyFromUrl(entry) ?? entry;
          }
          return entry;
        });
        await this.mediaService.deleteMultiple(keys);
      }

      await this.prisma.product.delete({
        where: { id },
      });
      return { type: 'hard' };
    }
  }

  async addImages(
    id: string,
    sellerId: string,
    addImagesDto: AddImagesDto,
  ): Promise<ProductResponseDto> {
    const product = await this.findOne(id);

    // Check ownership
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('You can only modify your own products');
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        images: {
          push: addImagesDto.images,
        },
      },
      include: PRODUCT_INCLUDE,
    });

    return this.toResponseDto(updatedProduct);
  }

  async removeImages(
    id: string,
    sellerId: string,
    removeImagesDto: RemoveImagesDto,
  ): Promise<ProductResponseDto> {
    const product = await this.findOne(id);

    // Check ownership
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('You can only modify your own products');
    }

    const newImages = product.images.filter(
      (img) => !removeImagesDto.images.includes(img),
    );

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        images: newImages,
      },
      include: PRODUCT_INCLUDE,
    });

    return this.toResponseDto(updatedProduct);
  }

  async getImageSignedUrls(productId: string): Promise<string[]> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const imageEntries = (Array.isArray(product.images) ? product.images : []) as string[];
    if (imageEntries.length === 0) return [];

    // Convertir les anciennes URLs complètes en keys S3
    const keys = imageEntries.map((entry) => {
      if (entry.startsWith('http://') || entry.startsWith('https://')) {
        return this.mediaService.extractKeyFromUrl(entry) ?? entry;
      }
      return entry;
    });

    return this.mediaService.getSignedUrls(keys);
  }

  async uploadImages(
    productId: string,
    userId: string,
    files: Express.Multer.File[],
  ): Promise<ProductResponseDto> {
    // Vérifier que le produit existe et appartient à l'utilisateur
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.sellerId !== userId) {
      throw new ForbiddenException('You can only upload images to your own products');
    }

    // Upload les images vers S3
    const uploadResults = await this.mediaService.uploadMultiple(
      files,
      MediaFolder.PRODUCTS,
      MediaType.IMAGE,
      {
        subfolder: productId,
        makePublic: true,
      },
    );

    // Extraire les keys S3 (pas les URLs)
    const newImageKeys = uploadResults.map((result) => result.key);

    // Ajouter les nouvelles keys aux images existantes
    const currentImages = product.images as string[];
    const updatedImages = [...currentImages, ...newImageKeys];

    // Mettre à jour le produit
    const updatedProduct = await this.prisma.product.update({
      where: { id: productId },
      data: {
        images: updatedImages,
      },
      include: PRODUCT_INCLUDE,
    });

    return this.toResponseDto(updatedProduct);
  }
}
