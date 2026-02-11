-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "stripe_payment_intent_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_stripe_payment_intent_id_key" ON "campaigns"("stripe_payment_intent_id");
