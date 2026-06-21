import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { AuditCategory, WithdrawalStatus } from '@prisma/client';

/**
 * Réconciliation wallet DB ↔ solde Stripe Connect (H1).
 *
 * Le solde applicatif `wallet.balance` (Postgres) et le solde réel du compte
 * Stripe Connect du testeur doivent rester cohérents : le wallet représente ce
 * que SuperTry doit / autorise à retirer, le Connect détient l'argent réel.
 *
 * Ce job est en LECTURE SEULE : il ne corrige jamais automatiquement les soldes
 * (trop risqué), il se contente de DÉTECTER les écarts et de les journaliser
 * (log + audit) pour revue manuelle. Les corrections C2 (idempotency keys
 * déterministes) + gardes d'idempotence rendent déjà le flux auto-réparateur ;
 * ce job apporte la visibilité proactive.
 *
 * Invariant vérifié (par testeur, en EUR) :
 *   solde Connect (available + pending)  ≈  wallet.balance + retraits en cours
 * où "retraits en cours" = withdrawals PENDING/PROCESSING (déjà débités du wallet
 * mais dont le payout n'a pas encore quitté le compte Connect).
 */
@Injectable()
export class WalletReconciliationScheduler {
  private readonly logger = new Logger(WalletReconciliationScheduler.name);

  /** Tolérance d'écart acceptée (centimes d'arrondi / timing de settlement). */
  private static readonly TOLERANCE_EUR = 0.01;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly auditService: AuditService,
  ) {}

  /** CRON quotidien à 5h (Europe/Paris). */
  @Cron('0 5 * * *', {
    name: 'wallet-reconciliation',
    timeZone: 'Europe/Paris',
  })
  async reconcileWallets() {
    const profiles = await this.prisma.profile.findMany({
      where: { stripeConnectAccountId: { not: null } },
      select: { id: true, stripeConnectAccountId: true },
    });

    if (profiles.length === 0) return;

    this.logger.log(`[WALLET-RECON] Réconciliation de ${profiles.length} compte(s) Connect`);

    let checked = 0;
    let drifts = 0;

    for (const profile of profiles) {
      try {
        const [wallet, inFlightAgg, balance] = await Promise.all([
          this.prisma.wallet.findUnique({
            where: { userId: profile.id },
            select: { balance: true },
          }),
          this.prisma.withdrawal.aggregate({
            where: {
              userId: profile.id,
              status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING] },
            },
            _sum: { amount: true },
          }),
          this.stripeService.getConnectAccountBalance(profile.stripeConnectAccountId!),
        ]);

        const walletBalanceEur = Number(wallet?.balance ?? 0);
        const inFlightEur = Number(inFlightAgg._sum.amount ?? 0);

        const connectAvailableEur = this.sumEur(balance.available);
        const connectPendingEur = this.sumEur(balance.pending);
        const connectTotalEur = connectAvailableEur + connectPendingEur;

        const expectedConnectEur = walletBalanceEur + inFlightEur;
        const drift = Math.round((connectTotalEur - expectedConnectEur) * 100) / 100;

        checked++;

        if (Math.abs(drift) > WalletReconciliationScheduler.TOLERANCE_EUR) {
          drifts++;
          this.logger.warn(
            `[WALLET-RECON] ÉCART détecté pour ${profile.id}: ` +
              `Connect=${connectTotalEur.toFixed(2)}€ (avail=${connectAvailableEur.toFixed(2)}, pending=${connectPendingEur.toFixed(2)}) ` +
              `vs attendu=${expectedConnectEur.toFixed(2)}€ (wallet=${walletBalanceEur.toFixed(2)} + enCours=${inFlightEur.toFixed(2)}) ` +
              `→ drift=${drift.toFixed(2)}€`,
          );

          await this.auditService.log(
            profile.id,
            AuditCategory.WALLET,
            'WALLET_RECONCILIATION_DRIFT',
            {
              connectAccountId: profile.stripeConnectAccountId,
              walletBalanceEur,
              inFlightWithdrawalsEur: inFlightEur,
              connectAvailableEur,
              connectPendingEur,
              expectedConnectEur,
              driftEur: drift,
            },
          );
        }
      } catch (error) {
        this.logger.error(
          `[WALLET-RECON] Échec réconciliation pour ${profile.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `[WALLET-RECON] Terminé : ${checked} compte(s) vérifié(s), ${drifts} écart(s) détecté(s)`,
    );
  }

  /** Somme en euros des entrées de solde Stripe en devise EUR (montants en centimes). */
  private sumEur(entries: { amount: number; currency: string }[]): number {
    return (
      entries
        .filter((e) => e.currency === 'eur')
        .reduce((acc, e) => acc + e.amount, 0) / 100
    );
  }
}
