-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'RETRY');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "message_id" TEXT,
ADD COLUMN     "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");
