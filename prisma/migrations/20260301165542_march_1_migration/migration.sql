/*
  Warnings:

  - A unique constraint covering the columns `[stripe_invoice_id]` on the table `campaigns` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripe_customer_id]` on the table `profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "business_rules" ALTER COLUMN "price_range_tiers" SET DEFAULT '[{"maxPrice":50,"step":5},{"maxPrice":100,"step":10},{"maxPrice":200,"step":25},{"maxPrice":99999,"step":50}]';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "stripe_invoice_id" TEXT,
ADD COLUMN     "stripe_invoice_url" TEXT;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "stripe_customer_id" TEXT;

-- AlterTable
ALTER TABLE "test_sessions" ADD COLUMN     "admin_document_requests" JSONB,
ADD COLUMN     "dispute_document_keys" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_stripe_invoice_id_key" ON "campaigns"("stripe_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_stripe_customer_id_key" ON "profiles"("stripe_customer_id");
