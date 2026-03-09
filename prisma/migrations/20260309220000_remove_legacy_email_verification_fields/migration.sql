-- AlterTable
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "email_verification_code";
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "email_verification_expires_at";
