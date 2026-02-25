-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "stripe_current_deadline" TIMESTAMP(3),
ADD COLUMN     "stripe_disabled_reason" TEXT,
ADD COLUMN     "stripe_identity_last_error" TEXT,
ADD COLUMN     "stripe_identity_session_id" TEXT,
ADD COLUMN     "stripe_identity_status" TEXT,
ADD COLUMN     "stripe_onboarding_status" TEXT,
ADD COLUMN     "stripe_requirements_currently_due" TEXT[],
ADD COLUMN     "stripe_requirements_past_due" TEXT[],
ADD COLUMN     "stripe_requirements_pending_verification" TEXT[];
