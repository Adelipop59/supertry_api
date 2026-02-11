-- AlterEnum: Add PENDING_ACTIVATION to CampaignStatus
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACTIVATION';

-- AlterEnum: Add new transaction types
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TESTER_CANCELLATION_REFUND';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TESTER_COMPENSATION';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CANCELLATION_COMMISSION';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'DISPUTE_RESOLUTION';

-- AlterEnum: Add CANCELLED to TransactionStatus
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable: Add cancellation tracking fields to campaigns
ALTER TABLE "campaigns"
ADD COLUMN IF NOT EXISTS "activation_grace_period_ends_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelled_by" TEXT,
ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;

-- CreateIndex: Add index for activation grace period
CREATE INDEX IF NOT EXISTS "campaigns_activation_grace_period_ends_at_idx" ON "campaigns"("activation_grace_period_ends_at");

-- AlterTable: Add cancellation business rules
ALTER TABLE "business_rules"
ADD COLUMN IF NOT EXISTS "campaign_activation_grace_period_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN IF NOT EXISTS "campaign_cancellation_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
ADD COLUMN IF NOT EXISTS "tester_cancellation_ban_days" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN IF NOT EXISTS "tester_cancellation_commission_percent" DECIMAL(5,2) NOT NULL DEFAULT 50.00,
ADD COLUMN IF NOT EXISTS "tester_compensation_on_pro_cancellation" DECIMAL(10,2) NOT NULL DEFAULT 5.00;
