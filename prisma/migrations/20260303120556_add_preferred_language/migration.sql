-- CreateEnum
CREATE TYPE "Language" AS ENUM ('FR', 'EN', 'ES', 'DE', 'IT', 'PT');

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "preferred_language" "Language" NOT NULL DEFAULT 'FR';
