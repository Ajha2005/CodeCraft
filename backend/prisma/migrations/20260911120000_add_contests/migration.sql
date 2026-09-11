-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "contestId" TEXT;

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "problemId" INTEGER NOT NULL,
    "challengerId" TEXT NOT NULL,
    "defenderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "durationSeconds" INTEGER NOT NULL DEFAULT 600,
    "winnerId" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_participants" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bestSubmissionId" TEXT,
    "verdict" TEXT,
    "totalPassed" INTEGER NOT NULL DEFAULT 0,
    "totalTests" INTEGER NOT NULL DEFAULT 0,
    "solvedAt" TIMESTAMP(3),
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "disconnectedAt" TIMESTAMP(3),
    "forfeited" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contest_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissions_contestId_idx" ON "submissions"("contestId");

-- CreateIndex
CREATE INDEX "contests_cellId_idx" ON "contests"("cellId");

-- CreateIndex
CREATE INDEX "contests_challengerId_idx" ON "contests"("challengerId");

-- CreateIndex
CREATE INDEX "contests_defenderId_idx" ON "contests"("defenderId");

-- CreateIndex
CREATE INDEX "contests_status_idx" ON "contests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "contest_participants_bestSubmissionId_key" ON "contest_participants"("bestSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "contest_participants_contestId_userId_key" ON "contest_participants"("contestId", "userId");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "territory_cells"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_bestSubmissionId_fkey" FOREIGN KEY ("bestSubmissionId") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
