-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'PURCHASE_REJECTED';

-- CreateTable
CREATE TABLE "purchase_attempts" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "order_number" TEXT,
    "product_price" DECIMAL(10,2),
    "shipping_cost" DECIMAL(10,2),
    "purchase_proof_keys" JSONB NOT NULL DEFAULT '[]',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_attempts_session_id_idx" ON "purchase_attempts"("session_id");

-- AddForeignKey
ALTER TABLE "purchase_attempts" ADD CONSTRAINT "purchase_attempts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
