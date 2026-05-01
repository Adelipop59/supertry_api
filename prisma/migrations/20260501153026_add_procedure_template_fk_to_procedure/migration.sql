-- AlterTable
ALTER TABLE "procedures" ADD COLUMN     "procedure_template_id" TEXT;

-- CreateIndex
CREATE INDEX "procedures_procedure_template_id_idx" ON "procedures"("procedure_template_id");

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_procedure_template_id_fkey" FOREIGN KEY ("procedure_template_id") REFERENCES "procedure_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
