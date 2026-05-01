import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateProcedureTemplateDto } from './dto/create-procedure-template.dto';
import { UpdateProcedureTemplateDto } from './dto/update-procedure-template.dto';
import { ProcedureTemplateResponseDto } from './dto/procedure-template-response.dto';

@Injectable()
export class ProcedureTemplatesService {
  constructor(private prisma: PrismaService) {}

  private toResponseDto(template: any): ProcedureTemplateResponseDto {
    return {
      ...template,
      steps: template.steps?.map((step: any) => ({
        ...step,
        description: step.description ?? undefined,
        checklistItems: step.checklistItems ?? undefined,
      })),
    };
  }

  async create(
    sellerId: string,
    createDto: CreateProcedureTemplateDto,
  ): Promise<ProcedureTemplateResponseDto> {
    const { steps, ...templateData } = createDto;

    const template = await this.prisma.procedureTemplate.create({
      data: {
        ...templateData,
        sellerId,
        steps: {
          create: steps,
        },
      },
      include: {
        steps: {
          orderBy: { order: 'asc' },
        },
      },
    });

    return this.toResponseDto(template);
  }

  async findAll(sellerId: string): Promise<ProcedureTemplateResponseDto[]> {
    const templates = await this.prisma.procedureTemplate.findMany({
      where: { sellerId },
      include: {
        steps: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map((t) => this.toResponseDto(t));
  }

  async findOne(
    id: string,
    sellerId: string,
  ): Promise<ProcedureTemplateResponseDto> {
    const template = await this.prisma.procedureTemplate.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!template) {
      throw new NotFoundException(
        `Procedure template with ID '${id}' not found`,
      );
    }

    // Check ownership
    if (template.sellerId !== sellerId) {
      throw new ForbiddenException(
        'You can only access your own procedure templates',
      );
    }

    return this.toResponseDto(template);
  }

  async update(
    id: string,
    sellerId: string,
    updateDto: UpdateProcedureTemplateDto,
  ): Promise<ProcedureTemplateResponseDto> {
    await this.findOne(id, sellerId);

    const { steps, ...templateData } = updateDto;

    // If steps are provided, replace all existing steps
    const updateData: any = { ...templateData };

    if (steps) {
      updateData.steps = {
        deleteMany: {},
        create: steps,
      };
    }

    const template = await this.prisma.procedureTemplate.update({
      where: { id },
      data: updateData,
      include: {
        steps: {
          orderBy: { order: 'asc' },
        },
      },
    });

    return this.toResponseDto(template);
  }

  async remove(id: string, sellerId: string): Promise<void> {
    await this.findOne(id, sellerId);

    const blockingStatuses: CampaignStatus[] = [
      CampaignStatus.DRAFT,
      CampaignStatus.PENDING_PAYMENT,
      CampaignStatus.PENDING_ACTIVATION,
      CampaignStatus.ACTIVE,
    ];

    const usage = await this.prisma.procedure.findFirst({
      where: {
        procedureTemplateId: id,
        campaign: { status: { in: blockingStatuses } },
      },
      select: { id: true },
    });

    if (usage) {
      throw new BadRequestException(
        "Cette procédure est utilisée dans une campagne en cours. Terminez ou annulez la campagne avant de la supprimer.",
      );
    }

    await this.prisma.procedureTemplate.delete({
      where: { id },
    });
  }
}
