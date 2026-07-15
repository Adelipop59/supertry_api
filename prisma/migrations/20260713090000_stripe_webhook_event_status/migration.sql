-- SEC-S3 : fiabilisation des webhooks Stripe.
-- Avant : la ligne de déduplication était insérée AVANT le traitement et le contrôleur
-- renvoyait 200 à Stripe même en cas d'échec du handler → l'événement était perdu
-- définitivement (pas de retry Stripe, rejeu manuel bloqué par la déduplication).
-- Désormais un statut distingue PROCESSING / PROCESSED / FAILED ; seul PROCESSED
-- court-circuite un événement entrant.

-- CreateEnum
CREATE TYPE "StripeWebhookStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "stripe_webhook_events"
  ADD COLUMN "status" "StripeWebhookStatus" NOT NULL DEFAULT 'PROCESSING',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Les lignes existantes correspondent à des événements déjà consommés : on les
-- considère comme traités avec succès pour ne pas les rejouer après déploiement.
UPDATE "stripe_webhook_events" SET "status" = 'PROCESSED';

-- processed_at devient nullable (renseigné uniquement en cas de succès).
ALTER TABLE "stripe_webhook_events"
  ALTER COLUMN "processed_at" DROP NOT NULL,
  ALTER COLUMN "processed_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "stripe_webhook_events_status_idx" ON "stripe_webhook_events"("status");
