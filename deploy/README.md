# CodeCraft deploy files

Everything needed to run the backend on the one small EC2 box: Nginx in front,
the NestJS backend under pm2 behind it, and Piston (the code runner) in one
Docker container. The frontend is on Vercel and the database and Redis are
hosted (Supabase, Redis Cloud); none of that is in this folder.

**The step-by-step deploy order is in `RUNBOOK.md` in this folder.** This page is
the index: what each file is, where it goes and when it is used.

## How the pieces connect

```
browser -> [Cloudflare, optional] -> Nginx :80/:443 -> backend 127.0.0.1:3000 -> Piston 127.0.0.1:2000
```

Only Nginx listens on the public interface. The AWS security group cannot be
changed, so the other two are made unreachable from outside by binding them to
loopback: the backend because of `HOST=127.0.0.1` (also its default), Piston
because `run-piston.sh` publishes it as `127.0.0.1:2000:2000`. Never set `HOST`
to `0.0.0.0`, and never change the Piston port mapping to `-p 2000:2000`: Docker
publishes ports around the host firewall (ufw), and Piston runs strangers' code.

## Files

| File | What it is | Where it goes on the server | When it is used |
|---|---|---|---|
| `nginx/00-codecraft-http.conf` | Nginx settings at `http{}` level: rate-limit zones, 429 instead of 503, the WebSocket `map`, gzip tuning, `server_tokens off`. | Copy to `/etc/nginx/conf.d/00-codecraft-http.conf`. The `00-` keeps it ahead of the server file. | At install, and when tuning the limits. Then `nginx -t && systemctl reload nginx`. |
| `nginx/bootstrap-http.conf` | A temporary port-80-only site, used only to get the first Let's Encrypt certificate (the real site cannot load until the certificate exists). | Copy to `/etc/nginx/sites-available/codecraft-bootstrap.conf` with `api.example.com` replaced, enable it, then remove its link when the real site is enabled. Never keep both enabled. | Once, on a new box, before `codecraft-api.conf`. |
| `nginx/codecraft-api.conf` | The server blocks: a catch-all that drops unknown hosts, port 80 (ACME challenge, then redirect to HTTPS), port 443 (TLS, reverse proxy to `127.0.0.1:3000`, Socket.IO, `client_max_body_size 128k`). It needs only the certificate and key from Let's Encrypt: the TLS settings are in the file, so certbot's own `options-ssl-nginx.conf` is not required. | Copy to `/etc/nginx/sites-available/codecraft-api.conf` and link it into `sites-enabled/`. Replace `api.example.com` (marked in the file) and remove Ubuntu's `default` site. | At install, after the DNS record exists and the certificate has been issued through `bootstrap-http.conf`. |
| `nginx/cloudflare-realip.conf` | Optional. Restores the real visitor address when the API hostname is proxied by Cloudflare. | Copy to `/etc/nginx/snippets/cloudflare-realip.conf`, then uncomment the `include` line in `codecraft-api.conf`. | Only if Cloudflare's proxy (orange cloud) is on for the API hostname. Refresh its IP list first (see its header). |
| `pm2/ecosystem.config.cjs` | The pm2 process definition: runs `dist/src/main.js`, loads `/etc/codecraft/backend.env`, one process, memory cap, restart rules, log files. | Stays in the repo checkout; not copied. Its `cwd` is `/home/ubuntu/CodeCraft/backend`: change it if the repo is somewhere else (for example `/opt/codecraft`). | Every start and restart: `pm2 start <repo>/deploy/pm2/ecosystem.config.cjs`, then `pm2 save`. |
| `piston/run-piston.sh` | Creates the Piston container with every flag (`--privileged`, loopback-only port, memory, swap, pids and cpu limits, volume `piston-packages`, restart policy), installs python 3.10.0 and gcc 10.2.0, and checks the result with `docker inspect`. | Not installed anywhere. Run it from the checkout, once, as a user in the `docker` group. | First deploy; after any change to `limits.env` or to the flags in the script; to upgrade the image. It asks before it replaces a running container. |
| `piston/limits.env` | Piston's own limits (timeouts, memory, output size, processes, no network) as environment variables for the container. | Stays in the repo; `run-piston.sh` hands it to `docker run --env-file`. | Read each time the container is created. |
| `escape-tests/` | The hostile-program tests for Piston (`run-in-docker.sh` is the one to run) and their offline self-test. See `escape-tests/README.md`. | Run from the checkout on the EC2 box. | After the first deploy and after every change to Piston's limits or image. Run when nobody is using the site. |
| `with-prod-env.sh` | Runs one command with `/etc/codecraft/backend.env` loaded (nothing printed, nothing exported into your shell), for example `cd backend && ../deploy/with-prod-env.sh npx prisma migrate deploy`. | Not installed; run it from the checkout. | Migrations, one-off scripts, and checking that a setting is present. |
| `backup-db.sh` | Takes a `pg_dump` of the production database (through a throwaway Postgres container) and checks the dump. | Not installed; run it from the checkout, as a user in the `docker` group. | Before every release. |
| `restore-db.sh` | Puts a backup made by `backup-db.sh` back: asks you to type the database name, drops the tables, restores in one transaction, prints the row counts. | Not installed; run it from the checkout, as a user in the `docker` group, with the backend stopped. | Only to roll a release back (`RUNBOOK.md`, section 3). |
| `post-deploy-check.mjs` | A smoke test of the deployed API: `node deploy/post-deploy-check.mjs https://api.yourdomain.com`. | Run from your own computer (Node 20+), not from the box. | After a release, and when something looks wrong. |
| `RUNBOOK.md` | The step-by-step deploy order and commands. | Read it. | A fresh EC2 box, or a rebuild. |

## A fresh EC2 box, in order

The commands for each step are in `RUNBOOK.md`; this is only the shape.

1. Swap, then Docker, Nginx, certbot, Node 22 and pm2.
2. Piston: `deploy/piston/run-piston.sh`.
3. `/etc/codecraft/backend.env`, filled in from `backend/.env.example`.
4. Build the backend (`npm run build`) and start it with `pm2` from `deploy/pm2/ecosystem.config.cjs`.
5. DNS, the Nginx files and the Let's Encrypt certificate.
6. Check `https://<your api host>/health` and run `node deploy/post-deploy-check.mjs` from your computer, then sign in from the Vercel frontend.
7. `deploy/escape-tests/run-in-docker.sh` (when nobody is on the site).

`DEPLOYMENT.md` at the repo root is the overview of what runs where and why; this
folder is the detail. If the two ever disagree, the files in this folder are what
actually runs.

## The two env files

They hold different things and are read by different programs.

- **`/etc/codecraft/backend.env`** is the backend's settings, secrets included
  (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `GOOGLE_*`, ...). Start from
  `backend/.env.example`, copy it to this path and fill it in. It lives outside
  the repo and is never committed. `chmod 600`, owned by the user that runs
  pm2 (a root-owned 0600 file cannot be read by a pm2 that runs as `ubuntu`,
  and Node then refuses to start). pm2 passes it to Node with
  `node_args: '--env-file=/etc/codecraft/backend.env'` (Node 20.6 or newer), so it
  is read at every start and restart: after editing it, run
  `pm2 restart codecraft-backend`. Do not keep a `backend/.env` next to the code
  as well: the app also loads that one and it would silently fill gaps. The
  runner settings in it (`PISTON_URL`, `PISTON_MAX_CONCURRENCY`, `JUDGE_*`) can
  lower Piston's limits for a request, never raise them.
- **`deploy/piston/limits.env`** is the Piston container's environment. It has no
  secrets and is in the repo. Every name starts with `PISTON_` because that is how
  Piston reads its settings. Plain `KEY=VALUE` lines, no quotes, no trailing
  comments (`run-piston.sh` refuses a file that breaks this). Never put a secret
  in it: it is the container's environment, and the escape tests check that jobs
  cannot see it. To change a limit, edit the file and run `run-piston.sh` again.

## pm2 and the entry file

pm2 must be started from `deploy/pm2/ecosystem.config.cjs`, which runs
**`dist/src/main.js`**: that is where `npm run build` puts the entry file (not
`dist/main`, and not `npm run start:dev`, which runs the watch-mode dev server
and ignores `backend.env`). The app binds **`127.0.0.1:3000` only**; to check:
`ss -ltn | grep :3000` must show `127.0.0.1:3000`, never `0.0.0.0:3000` or `*:3000`.

## When something is wrong

- **Nginx answers 502.** The backend is not running, or not on `127.0.0.1:3000`.
  `pm2 list`; `pm2 logs codecraft-backend --lines 50 --nostream` (a missing or
  weak setting is named there, never its value);
  `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health` should
  print 200; `ss -ltn | grep :3000`. A missing `dist/src/main.js` means
  `npm run build` was not run in `backend/`.
- **429 for everybody.** Every visitor looks like one address, so the per-IP limits
  trip for all. Nginx must send `X-Forwarded-For $remote_addr` (it does in
  `codecraft-api.conf`) and `TRUST_PROXY_HOPS=1` must be in `backend.env`. Behind
  Cloudflare, include `cloudflare-realip.conf`, or `$remote_addr` is Cloudflare's
  edge. A 429 from Nginx itself has no CORS headers, so the browser reports it as
  a network error.
- **Sockets fail or never leave long polling.** The `Upgrade` headers are missing.
  `00-codecraft-http.conf` must be in `/etc/nginx/conf.d/` (it defines the
  `$connection_upgrade` map; without it `nginx -t` fails), the request must reach
  the `/socket.io/` location, and with Cloudflare the WebSockets setting must be on.
- **Runs answer 503 "code runner unavailable", or Piston says "package not installed" /
  "runtime is unknown".** `docker ps`; `docker logs --tail 50 piston-api`;
  `curl -s http://127.0.0.1:2000/api/v2/runtimes` must list `python 3.10.0` and
  `c++ 10.2.0`. If not, install them (each download takes a few minutes):

  ```bash
  curl -fsS -X POST http://127.0.0.1:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"python","version":"3.10.0"}'
  curl -fsS -X POST http://127.0.0.1:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"gcc","version":"10.2.0"}'
  ```

  The packages live in the `piston-packages` volume, so re-creating the container
  keeps them. If the container exits right after it starts, read its log: Piston
  needs a host that uses cgroup v2 only, which Ubuntu 24.04 does.
