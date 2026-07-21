-- Messagerie de litige à 3 parties (marque ↔ testeur ↔ SuperTry).
-- Ajoute l'enum de visibilité + la table des messages de litige, ancrés sur une TestSession.

-- CreateEnum
CREATE TYPE "DisputeVisibility" AS ENUM ('BOTH', 'BRAND_ONLY', 'TESTER_ONLY');

-- AlterEnum : nouveau type de notification pour les messages de litige
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_MESSAGE';

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_role" "UserRole" NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "visibility" "DisputeVisibility" NOT NULL DEFAULT 'BOTH',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_messages_session_id_idx" ON "dispute_messages"("session_id");

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
