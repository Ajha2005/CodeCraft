# Security

CodeCraft is a public website that shows real students' names-as-usernames, scores and territory, and that runs code strangers type into a browser. It is built and reviewed as if the internet were hostile. This page says what is in place, what was deliberately left out, and what is still open. Everything under "In place" is covered by tests (see [Testing](#testing)).

## Who can do what

| Actor | How they get in | What they can do |
|---|---|---|
| **Anonymous** | Nothing | Load the login page and its three counters (`/problems?limit=1`, `/leaderboard/college?limit=1`, `/territories`). Every other endpoint answers 401. |
| **Guest (demo visitor)** | "Try the demo": `POST /auth/guest`. No account, no database row, no refresh token; a 2-hour token (`role: GUEST`, `sub: guest:<uuid>`) | **Read** problems, the leaderboard, public profiles and the live map. **Run** code against a problem's *published examples* (`POST /run`). Nothing else: every other write is refused with 403, and nothing a guest does is saved, scored or captured. |
| **Student** | Google sign-in restricted to verified `@thapar.edu` addresses | Everything a guest can, plus submit solutions, earn score, capture territory and duel. Only ever their own submissions, scores and duels. |
| **System** | n/a | Judge worker, regrid script, audit writer. |

A guest token is a different *kind* of token, not a weak user: the token check refuses a guest role with a user id (and the reverse), so one cannot pose as the other.

## In place

| Area | What was done |
|---|---|
| **Authentication** | New accounts come from Google sign-in only. Domain check on a *verified* address, `hd=thapar.edu` hint, a random `state` kept in an HttpOnly cookie and checked on return (login CSRF). Emails are lower-cased and strictly validated (no quoted local parts, exact domain). The access token never travels in a URL: Google's redirect carries a one-time code (32 random bytes, only its SHA-256 stored in Redis, 60 s, single use) that the page trades for the token over `POST /auth/exchange`. Signing in with Google links an existing account on the same address and wipes any password on it, so nobody who registered an address they do not own keeps a way in. Email + password sign-in is switched off (`PASSWORD_LOGIN_ENABLED`); if turned on it does one bcrypt (cost 12) comparison whether or not the address exists and answers with one generic error. |
| **Tokens** | HS256 pinned, issuer and audience checked, payload is only `{sub, role}` (no email). The secret has no fallback anywhere: the server refuses to start unless `JWT_SECRET` is set, at least 32 characters, not a known placeholder, and not low-variety. Students' tokens last 12 h (`JWT_EXPIRES_IN`), guests' 2 h. The app signs out on a 401 or on expiry. |
| **Authorization** | A global guard makes every route require a token unless it is marked `@Public()`. Guests are allowed `GET`, `POST /auth/guest` and `POST /run` and nothing else (enforced in one place, so a new route is closed to them by default). Routes about "me" are `/me/...`: there is no endpoint that takes someone else's user id. Submissions are readable only by their owner (anyone else gets 404). A duel room is open to its two players only. Both WebSocket gateways check the token in the handshake; the duel namespace refuses guests. |
| **Data exposure** | Responses are hand-written DTOs, not database rows. The hidden test cases of a problem are never part of any response (problems, duel rooms, anywhere). The map, the leaderboard and public profiles identify players by username only, and whether a cell or row is "yours" (`isMe`) is decided by the server. No email, real name, id or password hash leaves the API for another player. The grading queue carries only a submission id: the code and the hidden tests are read back from Postgres by the worker, so they never sit in Redis. |
| **Rate limits** | A global limit per route (per account for students; per IP for guests and anonymous callers), and tighter ones where it matters: demo sessions 100/hour/IP, Google sign-in and code exchange 120/min/IP (a class can share one campus address), password sign-in 10/min, `/run` 10/min for guests and 30/min for students, submissions 10/min, duel challenges 10/hour. At most 3 submissions and 5 challenges may be pending per student. |
| **Code execution** | The backend never runs student code. Piston runs in one container published on loopback only, with memory, process and CPU caps, no network, and per-request run/compile time and memory limits. A concurrency limiter lets at most 2 programs run at once, a guest at most 1, and serves graded submissions before students before guests, so a flood of demo runs cannot starve grading. `/run` executes only a problem's published examples, never its hidden tests, and writes nothing. Code is capped at 20,000 characters. |
| **Transport and API hardening** | `helmet` (API content-security-policy `default-src 'none'`, HSTS in production), CORS limited to the configured frontend origin(s) (never localhost in production, same list for both WebSocket gateways), `trust proxy` set to exactly the one Nginx hop, request bodies limited (64 KB JSON), `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`, and one exception filter that turns anything unexpected into a generic 500 (the stack goes to the server log, not the client). The server listens on `127.0.0.1` only, so the open port in the cloud firewall cannot reach it. |
| **Frontend** | Vercel serves a strict content-security-policy (`script-src 'self'`, `connect-src` limited to the API, `frame-ancestors 'none'`), HSTS, `nosniff`, a referrer policy and a permissions policy. A build step fails if the policy does not allow the API the build points at. No source maps are published. |
| **Audit log** | The `audit_logs` table records account creation and linking, duel created/accepted/declined/resolved, territory transfers, and map regrids, with actor, target, reason and time. Log lines never contain emails, tokens or code. |
| **Secrets and config** | Environment is validated at start-up and failures name the setting, never its value. `backend/.env.example` lists every setting; `.env*` files are git-ignored. The compiled entry point, process manager, Nginx and Piston settings are in `deploy/`. |

### Left out on purpose

These appear in the original design but are **not built**, and nothing above relies on them: OTP verification (Google verifies the mailbox instead), refresh tokens and token revocation (tokens are short-lived instead), admin roles, bans and review queues, and the anti-cheating flag engine. They are Phase 6 work. Until then a student's token cannot be revoked before it expires (12 h), and nothing detects collusion or copied solutions.

## OWASP Top 10 (2021) checklist

| # | Risk | Status | Notes |
|---|---|---|---|
| A01 | Broken access control | **Fixed** | Default-deny guard; owner-only data; no id-keyed routes; guests read-only; duel and WebSocket checks. Anyone signed in can read public profiles and the live map by design. |
| A02 | Cryptographic failures | **Fixed**, one item **accepted** | No fallback secrets, strength check, pinned algorithm, hashed one-time codes, bcrypt 12, HTTPS and HSTS. *Accepted:* the Redis Cloud free plan gives a plain `redis://` link (see below); only hashes, ids and counters cross it. |
| A03 | Injection | **Fixed** | Parameterised queries throughout (Prisma; the few raw queries are tagged templates); DTO whitelisting; React escaping plus a strict CSP; code runs only in the sandbox. |
| A04 | Insecure design | **Fixed**, one item **remaining** | Hidden tests never leave the server; guest model is an allowlist; execution limiter; pending caps; minimal queue payloads. *Remaining:* no anti-cheat, no bans (Phase 6). |
| A05 | Security misconfiguration | **Fixed**, hardening **remaining** | Helmet, CORS allowlist, loopback bind, proxy trust, body limits, generic errors, committed Nginx/pm2/Piston config, dead Judge0 config and the sample route removed. *Remaining (yours to apply):* require IMDSv2 with hop limit 1 on the instance, rotate the secrets listed in the deployment report, confirm Supabase's Data API / RLS. |
| A06 | Vulnerable components | **Partly fixed** | Safe audit fixes applied. *Remaining, needs a decision:* the Prisma CLI chain (dev tooling; npm only offers a downgrade to Prisma 6) and DOMPurify inside `monaco-editor` (fixed by `monaco-editor` 0.57; moderate, only reachable through the editor's own hover text). |
| A07 | Identification and authentication failures | **Fixed** | Google-only sign-up with `state`, verified-email check, pre-hijack fix, normalised emails, generic errors, throttled endpoints, no token in URLs, clean sign-out on expiry. *Accepted:* tokens live in `localStorage` (a strict CSP is the mitigation); there is no MFA beyond Google's. |
| A08 | Software and data integrity failures | **Mostly fixed** | Lockfiles committed; migrations through `prisma migrate deploy`; the map regrid is one verified transaction with an audit row; dry run first. *Accepted:* dependencies are installed on the server with `npm ci`, with the usual supply-chain exposure. |
| A09 | Logging and monitoring failures | **Partly fixed** | Audit table, redacted logs, `/health` and `/health/ready`. *Remaining:* no alerting or central log shipping; add an uptime check on `/health/ready`. |
| A10 | Server-side request forgery | **Fixed** | The server only calls Piston (address from the environment) and Google's OAuth endpoints; no user-supplied URL is ever fetched. Sandboxed programs have no network; the metadata-service hop limit above closes the remaining path. |

## Accepted risks and open items

- **Redis Cloud free plan.** The plan hands out a plain `redis://` endpoint (that is what is configured). Whether the plan can offer TLS could not be checked from the build environment; if the dashboard has no TLS option, treat the link as cleartext. The exposure is limited on purpose: Redis holds a SHA-256 of one-time login codes, leaderboard scores keyed by id, job ids and rate counters, never code, tests or tokens, and the Redis password is the one secret on the wire. Prefer the same region as the EC2 box. If a TLS endpoint exists, use a `rediss://` URL (both the app and the queue accept it). Running Redis on the EC2 box itself (loopback, 30 MB is nothing) is the clean alternative.
- **Redis has no persistence** on that plan, so the leaderboard disappears on a restart. The server rebuilds it from Postgres at start-up when it finds it empty (`npm run leaderboard:rebuild` does it by hand).
- **Docker `--privileged`.** Piston needs it. The container is capped and isolated from the network, but a kernel bug would still be a host problem; the box holds no secrets except the environment file, which is why the runbook keeps it `chmod 600` and why the metadata service must be locked down.
- **One instance.** Rate-limit counters and duel timers live in memory, so the backend must not be scaled to several processes without moving them to Redis.
- **Token revocation.** There is none before expiry (12 h students, 2 h guests); rotating `JWT_SECRET` signs everyone out at once.

## Testing

- Backend unit tests (`npm test`) cover guards, token rules, the exception filter, email handling, the code-execution limiter, the grid layout and the regrid planner.
- Backend end-to-end tests (`npm run test:e2e`, against a throwaway local Postgres and Redis) exercise the HTTP and WebSocket surface: access by actor, forged and malformed tokens (including one signed with the secret that used to be in the source), a guest being unable to write, `POST /run` creating no rows in any table, no hidden tests or private fields in any response, input validation, headers and CORS, Google sign-in state, rate limits, and a graded submission end to end. The regrid has its own end-to-end suite.
- Frontend tests (`npm test`) check the 1000-cell layout against the map's hit-testing, the data adapter, and the session and fetch helpers.
- Sandbox escape tests (`deploy/escape-tests`) try an infinite loop, a fork bomb, huge output, reading files and the process environment, and outbound network access against the real Piston container. They are run by hand on the server (the build environment has no Docker); see that folder's README.
- After each release: `node deploy/post-deploy-check.mjs https://<api host> --frontend https://<app host> --origin-ip <EC2 IP>` re-checks the live site from outside (no hidden or private fields, a guest cannot write, forged tokens are rejected, headers and CORS, ports 3000 and 2000 closed). It writes nothing to the database. Before each release: the OWASP list above and `deploy/RUNBOOK.md`.
