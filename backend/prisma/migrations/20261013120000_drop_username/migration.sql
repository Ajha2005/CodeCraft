/*
  Takes the public username out again. The usernames plan was dropped: players
  are shown under the name they signed in with (their name, else the start of
  their email), as before.

  Safe to run anywhere. Where 20261004120000_add_username was applied, the column
  and its unique index go (the generated "player_xxxxxx" names and any chosen
  usernames are discarded); where it was not, there is nothing to drop. That
  migration stays in the history untouched, so databases that already ran it
  just move forward.
*/

-- DropIndex
DROP INDEX IF EXISTS "User_username_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN IF EXISTS "username";
