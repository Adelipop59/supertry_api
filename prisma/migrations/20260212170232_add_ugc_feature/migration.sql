/*
  Warnings:

  - You are about to drop the column `cancellation_fee_percent` on the `business_rules` table. All the data in the column will be lost.
  - You are about to drop the column `cancellation_grace_period_minutes` on the `business_rules` table. All the data in the column will be lost.
  - You are about to drop the column `first_cancellation_ban_days` on the `business_rules` table. All the data in the column will be lost.
  - You are about to drop the column `second_cancellation_ban_days` on the `business_rules` table. All the data in the column will be lost.
  - You are about to drop the column `marketplace` on the `campaigns` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[stripe_refund_id]` on the table `transactions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripe_payment_intent_id]` on the table `ugcs` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'UGC_VALIDATED';
ALTER TYPE "NotificationType" ADD VALUE 'UGC_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'UGC_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'UGC_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'UGC_DISPUTED';
ALTER TYPE "NotificationType" ADD VALUE 'UGC_DISPUTE_RESOLVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UGCStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "UGCStatus" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "business_rules" DROP COLUMN "cancellation_fee_percent",
DROP COLUMN "cancellation_grace_period_minutes",
DROP COLUMN "first_cancellation_ban_days",
DROP COLUMN "second_cancellation_ban_days",
ADD COLUMN     "capture_delay_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "commission_fixed_fee" DECIMAL(10,2) NOT NULL DEFAULT 5.00,
ADD COLUMN     "kyc_required_after_tests" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "max_ugc_rejections" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "stripe_fee_percent" DECIMAL(5,4) NOT NULL DEFAULT 0.035,
ADD COLUMN     "ugc_default_deadline_days" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "campaigns" DROP COLUMN "marketplace",
ADD COLUMN     "marketplaces" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "payment_authorized_at" TIMESTAMP(3),
ADD COLUMN     "payment_captured_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "stripe_refund_id" TEXT;

-- AlterTable
ALTER TABLE "ugcs" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by" TEXT,
ADD COLUMN     "dispute_reason" TEXT,
ADD COLUMN     "dispute_resolution" TEXT,
ADD COLUMN     "dispute_resolved_at" TIMESTAMP(3),
ADD COLUMN     "dispute_resolved_by" TEXT,
ADD COLUMN     "disputed_at" TIMESTAMP(3),
ADD COLUMN     "rejection_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripe_payment_intent_id" TEXT;

-- CreateTable
CREATE TABLE "tester_ratings" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "rater_id" TEXT NOT NULL,
    "tester_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tester_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tester_ratings_session_id_key" ON "tester_ratings"("session_id");

-- CreateIndex
CREATE INDEX "tester_ratings_session_id_idx" ON "tester_ratings"("session_id");

-- CreateIndex
CREATE INDEX "tester_ratings_rater_id_idx" ON "tester_ratings"("rater_id");

-- CreateIndex
CREATE INDEX "tester_ratings_tester_id_idx" ON "tester_ratings"("tester_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_stripe_refund_id_key" ON "transactions"("stripe_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "ugcs_stripe_payment_intent_id_key" ON "ugcs"("stripe_payment_intent_id");

-- AddForeignKey
ALTER TABLE "tester_ratings" ADD CONSTRAINT "tester_ratings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tester_ratings" ADD CONSTRAINT "tester_ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tester_ratings" ADD CONSTRAINT "tester_ratings_tester_id_fkey" FOREIGN KEY ("tester_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
