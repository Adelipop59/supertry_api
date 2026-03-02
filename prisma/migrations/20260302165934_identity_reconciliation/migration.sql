-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "address_city" TEXT,
ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "address_postal_code" TEXT,
ADD COLUMN     "address_state" TEXT,
ADD COLUMN     "stripe_connect_data_synced_at" TIMESTAMP(3),
ADD COLUMN     "verification_mismatch_details" JSONB,
ADD COLUMN     "verification_resolved_at" TIMESTAMP(3),
ADD COLUMN     "verification_resolved_by" TEXT,
ADD COLUMN     "verification_status" TEXT;
