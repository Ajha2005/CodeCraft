/*
  Adds the public username.

  Existing users get a neutral generated one ("player_" + six hex characters
  derived from their id) rather than anything taken from their email or name,
  so nothing identifying becomes public by accident. They can pick their own
  later. The column is added as nullable first so the backfill can run, then
  made required and unique.
*/

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT;

-- Backfill: player_xxxxxx, with a numeric suffix if two ids ever share the same six characters
WITH candidates AS (
    SELECT
        "id",
        'player_' || substr(md5("id"), 1, 6) AS "base",
        ROW_NUMBER() OVER (PARTITION BY substr(md5("id"), 1, 6) ORDER BY "createdAt", "id") AS "n"
    FROM "User"
)
UPDATE "User" AS u
SET "username" = CASE WHEN c."n" = 1 THEN c."base" ELSE c."base" || '_' || c."n" END
FROM candidates AS c
WHERE u."id" = c."id";

-- Every row now has a value: make it required and unique
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
