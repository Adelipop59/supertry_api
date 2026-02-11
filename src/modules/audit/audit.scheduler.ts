import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from './audit.service';

@Injectable()
export class AuditScheduler {
  private readonly logger = new Logger(AuditScheduler.name);

  constructor(private readonly auditService: AuditService) {}

  /**
   * Cleanup automatique quotidien à 3h du matin
   * Supprime les logs > 90 jours (conformité RGPD)
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'audit-cleanup',
    timeZone: 'Europe/Paris', // Ajuster selon votre timezone
  })
  async handleDailyCleanup() {
    this.logger.log('Starting daily audit logs cleanup...');

    try {
      const deletedCount = await this.auditService.cleanup(90);
      this.logger.log(
        `Daily cleanup completed: ${deletedCount} audit logs deleted`,
      );
    } catch (error) {
      this.logger.error(`Daily cleanup failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Cleanup hebdomadaire le dimanche à minuit (optionnel)
   * Pour des nettoyages plus agressifs si nécessaire
   */
  @Cron(CronExpression.EVERY_WEEK, {
    name: 'audit-weekly-cleanup',
    timeZone: 'Europe/Paris',
  })
  async handleWeeklyCleanup() {
    this.logger.log('Starting weekly audit logs cleanup...');

    try {
      // Exemple: supprimer les logs > 30 jours pour certaines catégories
      // Vous pouvez personnaliser selon vos besoins
      const deletedCount = await this.auditService.cleanup(90);
      this.logger.log(
        `Weekly cleanup completed: ${deletedCount} audit logs deleted`,
      );
    } catch (error) {
      this.logger.error(`Weekly cleanup failed: ${error.message}`, error.stack);
    }
  }
}
