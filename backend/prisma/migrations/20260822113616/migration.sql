/*
  Warnings:

  - A unique constraint covering the columns `[svgPathId]` on the table `territories` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `svgPathId` to the `territories` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "territories" ADD COLUMN     "ownerColor" TEXT DEFAULT '#94a3b8',
ADD COLUMN     "svgPathId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "territories_svgPathId_key" ON "territories"("svgPathId");
