/*
  1. Every player gets a permanent, unique sequence number ("colorIndex"). Their
     map colour is derived from it, so no two players can share a colour. Adding
     a SERIAL column numbers the players that already exist, oldest rows first.
  2. A cell ownership can now point at the solve that earned it, so the scoring
     tab can show which cell each correct answer won. Older rows keep NULL.
*/

-- AlterTable
ALTER TABLE "User" ADD COLUMN "colorIndex" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_colorIndex_key" ON "User"("colorIndex");

-- AlterTable
ALTER TABLE "territory_cell_ownerships"
  ADD COLUMN "submissionId" TEXT,
  ADD COLUMN "captured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "territory_cell_ownerships_submissionId_idx" ON "territory_cell_ownerships"("submissionId");

-- AddForeignKey
ALTER TABLE "territory_cell_ownerships" ADD CONSTRAINT "territory_cell_ownerships_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
