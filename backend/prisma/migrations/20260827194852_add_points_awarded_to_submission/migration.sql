-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "noPointsReason" TEXT,
ADD COLUMN     "pointsAwarded" BOOLEAN NOT NULL DEFAULT false;
