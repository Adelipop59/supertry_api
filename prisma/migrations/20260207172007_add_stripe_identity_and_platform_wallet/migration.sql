-- AlterTable: Add stripeIdentityVerified to profiles table
ALTER TABLE "profiles" ADD COLUMN "stripe_identity_verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: PlatformWallet
CREATE TABLE "platform_wallets" (
    "id" TEXT NOT NULL,
    "escrow_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "commission_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "total_received" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_transferred" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_commissions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_wallets_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add stripePayoutId to withdrawals table
ALTER TABLE "withdrawals" ADD COLUMN "stripe_payout_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_stripe_payout_id_key" ON "withdrawals"("stripe_payout_id");
