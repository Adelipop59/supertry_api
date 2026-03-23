-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'PURCHASE_REIMBURSEMENT';

-- AlterTable
ALTER TABLE "test_sessions" ADD COLUMN     "bonus_amount" DECIMAL(10,2),
ADD COLUMN     "bonus_paid_at" TIMESTAMP(3),
ADD COLUMN     "purchase_reimbursed_at" TIMESTAMP(3),
ADD COLUMN     "purchase_reimbursement_amount" DECIMAL(10,2);
