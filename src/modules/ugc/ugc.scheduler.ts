import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UgcService } from './ugc.service';

/**
 * P0.2 — Application des deadlines UGC.
 *
 * Sans ce job, le champ `deadline` était purement cosmétique : une demande UGC
 * jamais acceptée pouvait rester REQUESTED indéfiniment, immobilisant l'escrow du
 * PRO et laissant l'autorisation Stripe expirer en silence.
 */
@Injectable()
export class UgcScheduler {
  private readonly logger = new Logger(UgcScheduler.name);

  constructor(private readonly ugcService: UgcService) {}

  /** Toutes les heures : expirer les demandes UGC dépassées. */
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpirations() {
    try {
      await this.ugcService.expireOverdueUgcs();
    } catch (error) {
      this.logger.error(`UGC expiration job failed: ${error.message}`, error.stack);
    }
  }

  /** Chaque jour à 9h : rappel J-1 aux testeurs. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleReminders() {
    try {
      await this.ugcService.sendUgcDeadlineReminders();
    } catch (error) {
      this.logger.error(`UGC reminder job failed: ${error.message}`, error.stack);
    }
  }
}
