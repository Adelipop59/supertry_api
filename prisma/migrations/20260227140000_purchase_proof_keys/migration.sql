-- AlterTable: replace purchaseProofUrl (single URL) with purchaseProofKeys (array of S3 keys)
ALTER TABLE "test_sessions" DROP COLUMN "purchase_proof_url",
ADD COLUMN     "purchase_proof_keys" JSONB NOT NULL DEFAULT '[]';
