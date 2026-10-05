# CodeCraft Deployment Guide

This page is the map: what runs where and why. **The exact order of a release (backup, migrate, regrid, restart, checks) is [`deploy/RUNBOOK.md`](./deploy/RUNBOOK.md)**, and the files it installs (Nginx, pm2, the Piston container, the sandbox escape tests) are in [`deploy/`](./deploy).

## Architecture

| Component | Where | Notes |
|---|---|---|
| Frontend | Vercel | Root directory `frontend`. Needs `VITE_API_BASE`; the content-security-policy in `frontend/vercel.json` must name the same API (the build fails if it does not). |
| Backend (NestJS) | AWS EC2 (Ubuntu, 1 GB + 1 GB swap) | Compiled with `npm run build`, run by pm2 from `deploy/pm2/ecosystem.config.cjs` as `node dist/src/main.js`. Listens on **127.0.0.1:3000 only**. |
| Nginx + Let's Encrypt | Same EC2 instance | The only public entry (80/443). Terminates TLS, forwards the real client address, upgrades WebSockets. `deploy/nginx/`. |
| Piston (code execution) | Same EC2 instance, one Docker container | `deploy/piston/run-piston.sh`: `--privileged` (Piston needs it), published on 127.0.0.1:2000 only, memory/process/CPU caps, no network inside the sandbox. |
| PostgreSQL | Supabase | Use the **session pooler** (port 5432) for the app and for migrations. Not the transaction pooler (migrations fail), not the direct connection (IPv6 only). |
| Redis | Redis Cloud (free, 30 MB, no persistence) | Plain `redis://` URL. Holds the leaderboard cache, the grading queue (submission ids only) and one-time login codes (hashed); the leaderboard is rebuilt from Postgres at start-up when empty. See "Redis" in [`docs/security.md`](./docs/security.md). |
| Domain / TLS | A real domain, ideally with Cloudflare's free proxy in front | **Do not use DuckDNS** for the public demo: some Indian ISPs (Jio, Airtel) block or intercept `duckdns.org` and show "site not safe" without a VPN, which a recruiter will see. See the Cloudflare note in the runbook. |

```
 browser ──https──▶ Vercel (static frontend)
    │
    └──https/wss──▶ [Cloudflare] ──▶ Nginx :443 ──▶ NestJS 127.0.0.1:3000 ──▶ Supabase Postgres
                                                        │        │
                                                        │        └──▶ Redis Cloud
                                                        └──▶ Piston 127.0.0.1:2000 (Docker)
```

## Settings

Backend settings live in `/etc/codecraft/backend.env` (mode 600), written from [`backend/.env.example`](./backend/.env.example), which documents every variable. The server refuses to start, naming the setting, if `JWT_SECRET` is missing, shorter than 32 characters or a placeholder, or if production settings (`REDIS_URL`, an https `FRONTEND_URL`) are missing. Piston's own limits are in `deploy/piston/limits.env`.

Google Cloud Console → Credentials → your OAuth client: the **Authorized redirect URI** must be exactly `GOOGLE_CALLBACK_URL` (for example `https://api.yourdomain.com/auth/google/callback`).

## Things that must stay true

- The backend binds `127.0.0.1` (`HOST`). The AWS security group cannot be changed, so this is what keeps port 3000 off the internet.
- `TRUST_PROXY_HOPS=1` and Nginx **overwrites** `X-Forwarded-For` with the connecting address. If either changes, every visitor looks like one IP (rate limits hit everyone) or can spoof their IP (rate limits hit no one).
- The backend runs as **one** pm2 process. Rate-limit counters and duel timers are in memory.
- `PASSWORD_LOGIN_ENABLED` stays unset or `false`; accounts come from Google sign-in.
- Piston is never published on a public interface.

## Frontend (Vercel)

- Root directory: `frontend`; env var `VITE_API_BASE` = the backend's https URL.
- Edit `connect-src` in `frontend/vercel.json` (`https://api.example.com` / `wss://api.example.com`) to your API origin before deploying; `npm run build` stops with the exact fix if it does not match `VITE_API_BASE`.
- If GitHub auto-deploy is not triggering, deploy by hand: `npm install -g vercel`, `vercel login`, then `cd frontend && vercel --prod`.

## Useful commands on the server

```bash
pm2 list
pm2 logs codecraft-backend --lines 50 --nostream
free -h                         # the box has 1 GB; watch swap
sudo dmesg | tail -30           # OOM kills
docker ps                       # piston-api should be Up
curl -s http://127.0.0.1:3000/health/ready      # database + Redis reachable
curl -s https://api.yourdomain.com/health
sudo nginx -t && sudo systemctl reload nginx
```

From your own computer, after any release: `node deploy/post-deploy-check.mjs https://api.yourdomain.com --frontend https://app.yourdomain.com --origin-ip <EC2 IP>` (a read-only smoke test of the live API; see the runbook).

## Known gotchas

- `src/common/redis/redis.module.ts` and `src/app.module.ts` must read `REDIS_URL` (they do; both the cache client and BullMQ accept `redis://` and `rediss://`).
- The compiled entry point is `dist/src/main.js` (not `dist/main`); `npm run start:prod` and the pm2 file both use the right path.
- `frontend/vercel.json` is required for React Router routes such as `/auth/callback` to not 404 on Vercel.
- A brand-new database: `npx prisma migrate deploy`, `npm run seed`, then `npm run regrid -- --apply` (builds the 1000-cell map). `prisma/generate-grid.ts` is the old 554-cell generator and refuses to run once the new grid exists.
