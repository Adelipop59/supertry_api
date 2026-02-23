-- CreateEnum
CREATE TYPE "TesterTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND');

-- CreateEnum
CREATE TYPE "XpEventType" AS ENUM ('TEST_COMPLETED', 'HIGH_RATING_BONUS', 'PERFECT_RATING_BONUS', 'LOW_BONUS_ALTRUISM', 'STREAK_BONUS', 'FIRST_TEST_BONUS', 'MILESTONE_BONUS', 'DISPUTE_REVERSAL', 'ADMIN_ADJUSTMENT');

-- AlterTable
ALTER TABLE "business_rules" ADD COLUMN     "tier_bronze_max_product_price" DECIMAL(10,2) NOT NULL DEFAULT 30.00,
ADD COLUMN     "tier_diamond_max_product_price" DECIMAL(10,2) NOT NULL DEFAULT 99999,
ADD COLUMN     "tier_gold_max_product_price" DECIMAL(10,2) NOT NULL DEFAULT 120.00,
ADD COLUMN     "tier_platinum_max_product_price" DECIMAL(10,2) NOT NULL DEFAULT 250.00,
ADD COLUMN     "tier_silver_max_product_price" DECIMAL(10,2) NOT NULL DEFAULT 60.00,
ADD COLUMN     "xp_first_test_bonus" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "xp_high_rating_bonus" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "xp_low_bonus_altruism" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "xp_perfect_rating_bonus" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "xp_streak_bonus" INTEGER NOT NULL DEFAULT 75,
ADD COLUMN     "xp_test_completed" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "campaign_criteria" ADD COLUMN     "min_tier" "TesterTier";

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "tier" "TesterTier" NOT NULL DEFAULT 'BRONZE',
ADD COLUMN     "tier_updated_at" TIMESTAMP(3),
ADD COLUMN     "total_xp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "xp_events" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "type" "XpEventType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "session_id" TEXT,
    "rating_id" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "xp_events_profile_id_idx" ON "xp_events"("profile_id");

-- CreateIndex
CREATE INDEX "xp_events_type_idx" ON "xp_events"("type");

-- CreateIndex
CREATE INDEX "xp_events_created_at_idx" ON "xp_events"("created_at");

-- AddForeignKey
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
