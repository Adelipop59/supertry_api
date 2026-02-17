import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductFilterDto } from './dto/product-filter.dto';
import { AddImagesDto } from './dto/add-images.dto';
import { RemoveImagesDto } from './dto/remove-images.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer un nouveau produit' })
  @ApiResponse({ status: 201, type: ProductResponseDto, description: 'Produit créé avec succès' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async create(
    @CurrentUser('id') userId: string,
    @Body() createProductDto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(userId, createProductDto);
  }

  @Get()
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Lister tous les produits avec filtres et pagination' })
  @ApiResponse({ status: 200, description: 'Liste paginée des produits' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiAuthResponses()
  async findAll(
    @Query() filterDto: ProductFilterDto,
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    return this.productsService.findAll(filterDto);
  }

  @Get('my-products')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Lister mes propres produits' })
  @ApiResponse({ status: 200, description: 'Liste paginée de mes produits' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiAuthResponses()
  async findMyProducts(
    @CurrentUser('id') userId: string,
    @Query() filterDto: ProductFilterDto,
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    return this.productsService.findMyProducts(userId, filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un produit par son ID' })
  @ApiResponse({ status: 200, type: ProductResponseDto, description: 'Produit trouvé' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiResponse({ status: 404, description: 'Produit non trouvé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ): Promise<ProductResponseDto> {
    return this.productsService.findOne(id, userId, role);
  }

  @Patch(':id')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Mettre à jour un produit' })
  @ApiResponse({ status: 200, type: ProductResponseDto, description: 'Produit mis à jour avec succès' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiResponse({ status: 404, description: 'Produit non trouvé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() updateProductDto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(id, userId, updateProductDto);
  }

  @Delete(':id')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un produit' })
  @ApiResponse({ status: 204, description: 'Produit supprimé avec succès' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiResponse({ status: 404, description: 'Produit non trouvé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.productsService.remove(id, userId);
  }

  @Post(':id/images')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Ajouter des images à un produit via URLs' })
  @ApiResponse({ status: 201, type: ProductResponseDto, description: 'Images ajoutées avec succès' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiResponse({ status: 404, description: 'Produit non trouvé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async addImages(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() addImagesDto: AddImagesDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.addImages(id, userId, addImagesDto);
  }

  @Post(':id/upload-images')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('images', 5)) // Max 5 images
  @ApiOperation({ summary: 'Uploader des images pour un produit' })
  @ApiResponse({ status: 201, type: ProductResponseDto, description: 'Images uploadées avec succès' })
  @ApiResponse({ status: 400, description: 'Fichiers invalides' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiResponse({ status: 404, description: 'Produit non trouvé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async uploadImages(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<ProductResponseDto> {
    return this.productsService.uploadImages(id, userId, files);
  }

  @Delete(':id/images')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Supprimer des images d\'un produit' })
  @ApiResponse({ status: 200, type: ProductResponseDto, description: 'Images supprimées avec succès' })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès interdit' })
  @ApiResponse({ status: 404, description: 'Produit non trouvé' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  @ApiValidationErrorResponse()
  async removeImages(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() removeImagesDto: RemoveImagesDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.removeImages(id, userId, removeImagesDto);
  }
}
