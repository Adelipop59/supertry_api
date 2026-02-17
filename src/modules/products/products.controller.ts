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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductFilterDto } from './dto/product-filter.dto';
import { AddImagesDto } from './dto/add-images.dto';
import { RemoveImagesDto } from './dto/remove-images.dto';
import { Roles } from '../../common/decorators/roles.decorator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Body() createProductDto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(userId, createProductDto);
  }

  @Get()
  async findAll(
    @Query() filterDto: ProductFilterDto,
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    return this.productsService.findAll(filterDto);
  }

  @Get('my-products')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async findMyProducts(
    @CurrentUser('id') userId: string,
    @Query() filterDto: ProductFilterDto,
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    return this.productsService.findMyProducts(userId, filterDto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.PRO, UserRole.ADMIN)
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
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.productsService.remove(id, userId);
  }

  @Post(':id/images')
  @Roles(UserRole.PRO, UserRole.ADMIN)
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
  async uploadImages(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<ProductResponseDto> {
    return this.productsService.uploadImages(id, userId, files);
  }

  @Delete(':id/images')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  async removeImages(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() removeImagesDto: RemoveImagesDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.removeImages(id, userId, removeImagesDto);
  }
}
