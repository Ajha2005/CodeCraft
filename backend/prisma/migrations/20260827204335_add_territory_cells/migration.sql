-- CreateTable
CREATE TABLE "territory_cells" (
    "id" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,

    CONSTRAINT "territory_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory_cell_ownerships" (
    "id" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "territory_cell_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "territory_cells_territoryId_idx" ON "territory_cells"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "territory_cells_territoryId_row_col_key" ON "territory_cells"("territoryId", "row", "col");

-- CreateIndex
CREATE INDEX "territory_cell_ownerships_cellId_idx" ON "territory_cell_ownerships"("cellId");

-- CreateIndex
CREATE INDEX "territory_cell_ownerships_userId_idx" ON "territory_cell_ownerships"("userId");

-- AddForeignKey
ALTER TABLE "territory_cells" ADD CONSTRAINT "territory_cells_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_cell_ownerships" ADD CONSTRAINT "territory_cell_ownerships_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "territory_cells"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_cell_ownerships" ADD CONSTRAINT "territory_cell_ownerships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
