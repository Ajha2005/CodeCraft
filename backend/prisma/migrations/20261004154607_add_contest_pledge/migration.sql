-- AlterTable
ALTER TABLE "contests" ADD COLUMN     "pledgedCellId" TEXT;

-- CreateIndex
CREATE INDEX "contests_pledgedCellId_idx" ON "contests"("pledgedCellId");

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_pledgedCellId_fkey" FOREIGN KEY ("pledgedCellId") REFERENCES "territory_cells"("id") ON DELETE SET NULL ON UPDATE CASCADE;
