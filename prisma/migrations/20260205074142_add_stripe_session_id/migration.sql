-- AlterTable
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "stripe_session_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_stripe_session_id_key" ON "transactions"("stripe_session_id");
