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
} as const;

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private mediaService: MediaService,
  ) {}

  private toResponseDto(product: any): ProductResponseDto {
    return {
      ...product,
      price: Number(product.price),
      shippingCost: Number(product.shippingCost),
      images: Array.isArray(product.images) ? product.images : [],
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

    const mappedProducts = products.map((p) => this.toResponseDto(p));
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

    const mappedProducts = products.map((p) => this.toResponseDto(p));
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

  async remove(id: string, sellerId: string): Promise<void> {
    const product = await this.findOne(id);

    // Check ownership
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('You can only delete your own products');
    }

    // Soft delete
    await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
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

    // Extraire les URLs
    const newImageUrls = uploadResults.map((result) => result.url);

    // Ajouter les nouvelles URLs aux images existantes
    const currentImages = product.images as string[];
    const updatedImages = [...currentImages, ...newImageUrls];

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
