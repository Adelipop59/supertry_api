-- Add stripeRefundId to Transaction table for Stripe Refund references
ALTER TABLE "transactions"
ADD COLUMN "stripe_refund_id" TEXT;

-- Add unique constraint
ALTER TABLE "transactions"
ADD CONSTRAINT "transactions_stripe_refund_id_key" UNIQUE ("stripe_refund_id");
