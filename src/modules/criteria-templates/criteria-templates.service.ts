import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCriteriaTemplateDto } from './dto/create-criteria-template.dto';
import { UpdateCriteriaTemplateDto } from './dto/update-criteria-template.dto';
import { CriteriaTemplateResponseDto } from './dto/criteria-template-response.dto';

@Injectable()
export class CriteriaTemplatesService {
  constructor(private prisma: PrismaService) {}

  private toResponseDto(template: any): CriteriaTemplateResponseDto {
    return {
      ...template,
      minAge: template.minAge ?? undefined,
      maxAge: template.maxAge ?? undefined,
      minRating: template.minRating ? Number(template.minRating) : undefined,
      maxRating: template.maxRating ? Number(template.maxRating) : undefined,
      minCompletedSessions: template.minCompletedSessions ?? undefined,
      requiredGender: template.requiredGender ?? undefined,
      requiredCountries: template.requiredCountries ?? undefined,
      requiredLocations: template.requiredLocations ?? undefined,
      excludedLocations: template.excludedLocations ?? undefined,
      requiredCategories: template.requiredCategories ?? undefined,
      maxSessionsPerWeek: template.maxSessionsPerWeek ?? undefined,
      maxSessionsPerMonth: template.maxSessionsPerMonth ?? undefined,
      minCompletionRate: template.minCompletionRate ?? undefined,
      maxCancellationRate: template.maxCancellationRate ?? undefined,
      minAccountAge: template.minAccountAge ?? undefined,
      lastActiveWithinDays: template.lastActiveWithinDays ?? undefined,
    };
  }

  async create(
    sellerId: string,
    createDto: CreateCriteriaTemplateDto,
  ): Promise<CriteriaTemplateResponseDto> {
    const template = await this.prisma.criteriaTemplate.create({
      data: {
        ...createDto,
        sellerId,
      },
    });

    return this.toResponseDto(template);
  }

  async findAll(sellerId: string): Promise<CriteriaTemplateResponseDto[]> {
    const templates = await this.prisma.criteriaTemplate.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map((t) => this.toResponseDto(t));
  }

  async findOne(
    id: string,
    sellerId: string,
  ): Promise<CriteriaTemplateResponseDto> {
    const template = await this.prisma.criteriaTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(
        `Criteria template with ID '${id}' not found`,
      );
    }

    // Check ownership
    if (template.sellerId !== sellerId) {
      throw new ForbiddenException(
        'You can only access your own criteria templates',
      );
    }

    return this.toResponseDto(template);
  }

  async update(
    id: string,
    sellerId: string,
    updateDto: UpdateCriteriaTemplateDto,
  ): Promise<CriteriaTemplateResponseDto> {
    await this.findOne(id, sellerId);

    const template = await this.prisma.criteriaTemplate.update({
      where: { id },
      data: updateDto,
    });

    return this.toResponseDto(template);
  }

  async remove(id: string, sellerId: string): Promise<void> {
    await this.findOne(id, sellerId);

    await this.prisma.criteriaTemplate.delete({
      where: { id },
    });
  }
}
