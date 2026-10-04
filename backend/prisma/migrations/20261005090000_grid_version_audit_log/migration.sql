
-- The unique key now includes the grid generation, so a regrid can reuse (row, col) numbers
-- in a zone without clashing with the retired cells. Nothing is deleted.
-- DropIndex
DROP INDEX "territory_cells_territoryId_row_col_key";

-- AlterTable
ALTER TABLE "territory_cells" ADD COLUMN     "gridVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "territory_cells_retiredAt_idx" ON "territory_cells"("retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "territory_cells_territoryId_gridVersion_row_col_key" ON "territory_cells"("territoryId", "gridVersion", "row", "col");


-- Emails are compared case-insensitively from now on (Google gives them lower-case and the
-- application normalises every address it reads). Lower-case the stored ones, but only where
-- that cannot collide with another account: the handful of true duplicates (same address in a
-- different case) are left exactly as they are and resolved by creation date in the code.
UPDATE "User" u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND (SELECT count(*) FROM "User" o WHERE lower(o."email") = lower(u."email")) = 1;
