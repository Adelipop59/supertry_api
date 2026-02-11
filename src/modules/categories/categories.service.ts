import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponseDto } from './dto/category-response.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  private toResponseDto(category: any): CategoryResponseDto {
    return {
      ...category,
      description: category.description ?? undefined,
      icon: category.icon ?? undefined,
    };
  }

  async create(
    createCategoryDto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    // Check if slug already exists
    const existingCategory = await this.prisma.category.findUnique({
      where: { slug: createCategoryDto.slug },
    });

    if (existingCategory) {
      throw new ConflictException(
        `Category with slug '${createCategoryDto.slug}' already exists`,
      );
    }

    const category = await this.prisma.category.create({
      data: createCategoryDto,
    });

    return this.toResponseDto(category);
  }

  async findAll(): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return categories.map((c) => this.toResponseDto(c));
  }

  async findOne(id: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID '${id}' not found`);
    }

    return this.toResponseDto(category);
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    // Check if category exists
    await this.findOne(id);

    // If slug is being updated, check for conflicts
    if (updateCategoryDto.slug) {
      const existingCategory = await this.prisma.category.findFirst({
        where: {
          slug: updateCategoryDto.slug,
          NOT: { id },
        },
      });

      if (existingCategory) {
        throw new ConflictException(
          `Category with slug '${updateCategoryDto.slug}' already exists`,
        );
      }
    }

    const category = await this.prisma.category.update({
      where: { id },
      data: updateCategoryDto,
    });

    return this.toResponseDto(category);
  }

  async remove(id: string): Promise<void> {
    // Check if category exists
    await this.findOne(id);

    // Soft delete by setting isActive to false
    await this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
