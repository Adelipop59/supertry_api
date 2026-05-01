-- AlterTable
ALTER TABLE "procedure_templates" ALTER COLUMN "description" DROP NOT NULL;

-- AlterTable
ALTER TABLE "procedures" ALTER COLUMN "description" DROP NOT NULL;
