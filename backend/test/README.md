# End-to-end tests

`npm test` needs nothing but Node. `npm run test:e2e` talks to a real Postgres and a real Redis, so it needs throwaway ones of your own:

```bash
# once: an empty local database with the app's migrations applied
createdb codecraft_test
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/codecraft_test npx prisma migrate deploy

# every time
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/codecraft_test \
TEST_REDIS_URL=redis://127.0.0.1:6379 \
npm run test:e2e
```

Without both variables the suites are skipped, not failed.

**They destroy what is in those two servers.** Every table of the database is emptied and the Redis database is flushed. To make that safe by construction the tests read `TEST_DATABASE_URL` / `TEST_REDIS_URL` only (never `DATABASE_URL` / `REDIS_URL`, which a `.env` may point at production), refuse any host that is not this machine, and refuse a database whose name does not contain `test`, `scratch` or `tmp` (`helpers/scratch-db.ts`).

| Suite | What it proves |
| --- | --- |
| `regrid.e2e-spec.ts` | The map moves from 554 to 1000 cells without deleting a row or losing anyone's territory; dry run writes nothing; running twice does nothing; a failed write rolls everything back; open duels follow their cells. |
| `api.e2e-spec.ts` | The whole HTTP and WebSocket surface with the code runner replaced by a scripted one: who can call what, a demo (guest) session can only read (and run the samples), no response carries hidden tests, other players' code, emails or user ids, `POST /run` writes nothing to any table, tokens forged with the old default secret (or `alg: none`, another algorithm, the wrong issuer, an expired one) are refused, input validation answers 400 instead of 500, security headers and CORS, Google sign-in state and the one-time login code, rate limits, and a graded submission end to end (the queue carries only the submission id). |

`helpers/legacy-grid.ts` rebuilds the old 554-cell grid exactly as `prisma/generate-grid.ts` made it, so a test can start from the live map's "before" state.
