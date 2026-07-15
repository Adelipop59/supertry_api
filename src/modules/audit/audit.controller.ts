import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';
import { AuditFilterDto } from './dto/audit-filter.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiAuthResponses } from '../../common/decorators/api-error-responses.decorator';

/**
 * Journal d'audit.
 *
 * SÉCURITÉ (SEC-S1) — Ce contrôleur était auparavant SANS aucun contrôle de rôle :
 * tout utilisateur authentifié (y compris un simple testeur) pouvait lire l'intégralité
 * du journal de la plateforme, lire celui d'un tiers via `?userId=` (IDOR), forger de
 * fausses entrées via POST, et SUPPRIMER tout le journal via DELETE /audit/cleanup
 * (anti-forensics). Corrections appliquées :
 *
 *  - `@Roles(ADMIN)` au niveau de la classe (le guard applique la règle du handler s'il
 *    en existe une, sinon celle de la classe).
 *  - `GET /audit/me` est scopé à l'utilisateur authentifié : l'identifiant provient
 *    désormais du token, plus jamais du query string.
 *  - `POST /audit` SUPPRIMÉ : l'écriture dans le journal doit rester strictement interne
 *    (via AuditService.log), sinon la piste d'audit est falsifiable.
 *  - `DELETE /audit/cleanup` SUPPRIMÉ : la purge est assurée par AuditScheduler (cron
 *    quotidien). Exposer une suppression en HTTP permettait d'effacer les preuves.
 */
@ApiTags('Audit')
@Controller('audit')
@Roles(UserRole.ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /audit
   * Liste tous les logs avec filtres et pagination — ADMIN uniquement.
   */
  @Get()
  @ApiOperation({ summary: "Liste du journal d'audit (ADMIN)" })
  @ApiAuthResponses()
  async findAll(@Query() filters: AuditFilterDto) {
    const { startDate, endDate, ...rest } = filters;

    return this.auditService.findAll({
      ...rest,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  /**
   * GET /audit/me
   * Logs de l'utilisateur AUTHENTIFIÉ uniquement.
   *
   * SÉCURITÉ : l'identifiant est extrait du token via @CurrentUser — il n'est plus
   * accepté depuis le query string. Sans cela, n'importe qui pouvait lire les logs
   * d'un autre utilisateur en passant `?userId=<victime>` (IDOR).
   */
  @Get('me')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: "Journal d'audit de l'utilisateur connecté" })
  @ApiAuthResponses()
  async findMyLogs(@CurrentUser('id') userId: string) {
    const logs = await this.auditService.findByUser(userId);
    return { data: logs };
  }

  /**
   * GET /audit/stats
   * Statistiques agrégées — ADMIN uniquement.
   */
  @Get('stats')
  @ApiOperation({ summary: "Statistiques du journal d'audit (ADMIN)" })
  @ApiAuthResponses()
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.auditService.getStats({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }
}
