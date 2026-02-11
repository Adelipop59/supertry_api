import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditCategory, Prisma } from '@prisma/client';

export interface AuditLogFilter {
  userId?: string;
  category?: AuditCategory;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalLogs: number;
  byCategory: Record<AuditCategory, number>;
  recentActions: Array<{ action: string; count: number }>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enregistre une action dans le journal d'audit
   * Mode fire-and-forget : ne bloque pas l'exécution
   */
  async log(
    userId: string | null,
    category: AuditCategory,
    action: string,
    details?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          category,
          action,
          details: details || Prisma.JsonNull,
        },
      });

      this.logger.debug(
        `Audit log created: [${category}] ${action} by user ${userId || 'SYSTEM'}`,
      );
    } catch (error) {
      // Ne pas faire échouer l'opération principale si le logging échoue
      this.logger.error(`Failed to create audit log: ${error.message}`, error.stack);
    }
  }

  /**
   * Récupère tous les logs avec filtres et pagination
   */
  async findAll(filters: AuditLogFilter = {}) {
    const {
      userId,
      category,
      action,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = filters;

    const where: Prisma.AuditLogWhereInput = {};

    if (userId) where.userId = userId;
    if (category) where.category = category;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Récupère les logs d'un utilisateur spécifique
   */
  async findByUser(userId: string) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limiter à 100 derniers logs
    });
  }

  /**
   * Récupère les statistiques d'audit
   */
  async getStats(dateRange?: { startDate?: Date; endDate?: Date }): Promise<AuditStats> {
    const where: Prisma.AuditLogWhereInput = {};

    if (dateRange?.startDate || dateRange?.endDate) {
      where.createdAt = {};
      if (dateRange.startDate) where.createdAt.gte = dateRange.startDate;
      if (dateRange.endDate) where.createdAt.lte = dateRange.endDate;
    }

    // Total de logs
    const totalLogs = await this.prisma.auditLog.count({ where });

    // Stats par catégorie
    const categoryStats = await this.prisma.auditLog.groupBy({
      by: ['category'],
      where,
      _count: { category: true },
    });

    const byCategory = categoryStats.reduce(
      (acc, stat) => {
        acc[stat.category] = stat._count.category;
        return acc;
      },
      {} as Record<AuditCategory, number>,
    );

    // Actions récentes les plus fréquentes
    const actionStats = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    });

    const recentActions = actionStats.map((stat) => ({
      action: stat.action,
      count: stat._count.action,
    }));

    return {
      totalLogs,
      byCategory,
      recentActions,
    };
  }

  /**
   * Supprime les logs plus anciens que le nombre de jours spécifié
   * Par défaut: 90 jours (conformité RGPD)
   */
  async cleanup(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(
      `Cleaned up ${result.count} audit logs older than ${olderThanDays} days`,
    );

    return result.count;
  }

  /**
   * Supprime les logs avant une date spécifique
   */
  async cleanupBeforeDate(date: Date): Promise<number> {
    const result = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: date,
        },
      },
    });

    this.logger.log(`Cleaned up ${result.count} audit logs before ${date.toISOString()}`);

    return result.count;
  }
}
