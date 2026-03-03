import {
  Injectable,
  HttpStatus,
} from '@nestjs/common';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
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
import {
  ProductImage,
  normalizeImageEntry,
} from './interfaces/product-image.interface';

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
    const rawEntries: any[] = Array.isArray(product.images) ? product.images : [];

    // Normaliser les entrées (legacy string → { clearKey, blurredKey })
    const normalized = rawEntries.map(normalizeImageEntry);

    // PRO/ADMIN endpoints → toujours retourner les images claires
    const keys = normalized.map((entry) => {
      const key = entry.clearKey;
      if (key.startsWith('http://') || key.startsWith('https://')) {
        return this.mediaService.extractKeyFromUrl(key) ?? key;
      }
      return key;
    });

    // Générer des signed URLs S3 (valides 1h) pour l'accès aux images
    const signedImages = keys.length > 0
      ? await this.mediaService.getSignedUrls(keys)
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
      throw new I18nHttpException('product.not_found', 'PRODUCT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // PRO can only see their own products
    if (role === UserRole.PRO && userId && product.sellerId !== userId) {
      throw new I18nHttpException('product.own_products_only', 'PRODUCT_OWN_ONLY', HttpStatus.FORBIDDEN);
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
        throw new I18nHttpException('product.campaign_access_only', 'PRODUCT_CAMPAIGN_ACCESS_ONLY', HttpStatus.FORBIDDEN);
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
      throw new I18nHttpException('product.own_products_only', 'PRODUCT_OWN_ONLY', HttpStatus.FORBIDDEN);
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
      throw new I18nHttpException('product.not_found', 'PRODUCT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (product.sellerId !== sellerId) {
      throw new I18nHttpException('product.own_products_only', 'PRODUCT_OWN_ONLY', HttpStatus.FORBIDDEN);
    }

    // Bloquer si le produit est dans une campagne active
    const activeCampaignStatuses = ['DRAFT', 'PENDING_PAYMENT', 'PENDING_ACTIVATION', 'ACTIVE'];
    const hasActiveCampaign = product.offers.some(
      (offer: any) => activeCampaignStatuses.includes(offer.campaign.status),
    );

    if (hasActiveCampaign) {
      throw new I18nHttpException('product.used_in_campaign', 'PRODUCT_IN_USE', HttpStatus.BAD_REQUEST);
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
      const rawEntries: any[] = Array.isArray(product.images)
        ? product.images
        : [];
      if (rawEntries.length > 0) {
        const keys: string[] = [];
        for (const entry of rawEntries) {
          const normalized = normalizeImageEntry(entry);
          // Ajouter clearKey et blurredKey (supprimer les deux versions)
          for (const key of [normalized.clearKey, normalized.blurredKey]) {
            if (key.startsWith('http://') || key.startsWith('https://')) {
              const extracted = this.mediaService.extractKeyFromUrl(key);
              if (extracted) keys.push(extracted);
            } else {
              keys.push(key);
            }
          }
        }
        // Non-bloquant : un échec S3 ne doit pas empêcher la suppression du produit
        try {
          await this.mediaService.deleteMultiple(keys);
        } catch {
          // Les images orphelines seront nettoyées ultérieurement
        }
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
      throw new I18nHttpException('product.own_products_only', 'PRODUCT_OWN_ONLY', HttpStatus.FORBIDDEN);
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
    const rawProduct = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });

    if (!rawProduct) {
      throw new I18nHttpException('product.not_found', 'PRODUCT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Check ownership
    if (rawProduct.sellerId !== sellerId) {
      throw new I18nHttpException('product.own_products_only', 'PRODUCT_OWN_ONLY', HttpStatus.FORBIDDEN);
    }

    const rawEntries: any[] = Array.isArray(rawProduct.images)
      ? rawProduct.images
      : [];
    const urlsToRemove = new Set(removeImagesDto.images);

    // Filtrer les entrées à garder et collecter les clés S3 à supprimer
    const keysToDelete: string[] = [];
    const remaining: ProductImage[] = [];

    for (const entry of rawEntries) {
      const normalized = normalizeImageEntry(entry);
      // Vérifier si la clearKey (ou son signed URL) correspond à une URL à supprimer
      if (urlsToRemove.has(normalized.clearKey)) {
        keysToDelete.push(normalized.clearKey, normalized.blurredKey);
      } else {
        remaining.push(normalized);
      }
    }

    // Supprimer les fichiers S3 (non-bloquant)
    if (keysToDelete.length > 0) {
      try {
        await this.mediaService.deleteMultiple(keysToDelete);
      } catch {
        // Les fichiers orphelins seront nettoyés ultérieurement
      }
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        images: remaining as any,
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
      throw new I18nHttpException('product.not_found', 'PRODUCT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const rawEntries: any[] = Array.isArray(product.images)
      ? product.images
      : [];
    if (rawEntries.length === 0) return [];

    // Normaliser et extraire les clés claires
    const keys = rawEntries.map((entry) => {
      const normalized = normalizeImageEntry(entry);
      const key = normalized.clearKey;
      if (key.startsWith('http://') || key.startsWith('https://')) {
        return this.mediaService.extractKeyFromUrl(key) ?? key;
      }
      return key;
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
      throw new I18nHttpException('product.not_found', 'PRODUCT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (product.sellerId !== userId) {
      throw new I18nHttpException('product.own_products_only', 'PRODUCT_OWN_ONLY', HttpStatus.FORBIDDEN);
    }

    const newImageEntries: ProductImage[] = [];

    for (const file of files) {
      // 1. Compresser l'image originale (claire) : qualité 80%, max 1920px, WebP
      const compressed = await this.mediaService.compressImage(file.buffer, {
        maxWidth: 1920,
        quality: 80,
      });
      const clearFilename = this.mediaService.generateFilename('image.webp');
      const clearResult = await this.mediaService.uploadFromBuffer(
        compressed.buffer,
        clearFilename,
        compressed.mimeType,
        MediaFolder.PRODUCTS,
        MediaType.IMAGE,
        { subfolder: productId, makePublic: true },
      );

      // 2. Générer la version floue + compressée : qualité 50%, max 800px, WebP
      const blurred = await this.mediaService.generateBlurredImage(
        file.buffer,
        { sigma: 20, maxWidth: 800, quality: 50 },
      );
      const blurredFilename = this.mediaService.generateFilename('image.webp');
      const blurredResult = await this.mediaService.uploadFromBuffer(
        blurred.buffer,
        blurredFilename,
        blurred.mimeType,
        MediaFolder.PRODUCTS,
        MediaType.IMAGE,
        { subfolder: productId, makePublic: true },
      );

      newImageEntries.push({
        clearKey: clearResult.key,
        blurredKey: blurredResult.key,
      });
    }

    // Fusionner avec les images existantes (gérer le format legacy)
    const currentImages = (product.images as any[]) || [];
    const normalizedCurrent = currentImages.map(normalizeImageEntry);
    const updatedImages = [...normalizedCurrent, ...newImageEntries];

    // Mettre à jour le produit
    const updatedProduct = await this.prisma.product.update({
      where: { id: productId },
      data: {
        images: updatedImages as any,
      },
      include: PRODUCT_INCLUDE,
    });

    return this.toResponseDto(updatedProduct);
  }
}
