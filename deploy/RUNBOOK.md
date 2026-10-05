# CodeCraft production runbook

How to put this release on the internet, in the order that keeps the data safe, and how to get back if it goes wrong. It assumes the setup in [`DEPLOYMENT.md`](../DEPLOYMENT.md): the frontend on Vercel, the backend on one small Ubuntu EC2 box (pm2 behind Nginx, Piston in Docker), Postgres on Supabase, Redis on Redis Cloud.

Everything below runs **on the EC2 box**, as the `ubuntu` user, with the repository at `/home/ubuntu/CodeCraft`, unless a step says "on your computer". Replace `api.yourdomain.com` and `app.yourdomain.com` with your real names.

Nothing in this folder was ever run against your production database. The whole release (backup, migrate from an older schema with real-looking data, account report, regrid dry run and apply, pm2 start, the check script through Nginx and TLS, and the restore) was rehearsed on a throwaway local Postgres and Redis. Two things could not be rehearsed there and are exercised for the first time on your server: Docker itself (the build environment has no Docker daemon, so the container flags in `run-piston.sh`, the `postgres` client image and the escape tests are verified by reading and by self-tests only) and the real services (Supabase, Redis Cloud, Let's Encrypt, Cloudflare, Google).

## The release at a glance

This release changes the shape of several API answers (the map, the leaderboard, sign-in), so an old frontend cannot talk to the new backend and the other way round. Plan a short **maintenance window** (about 20 to 30 minutes, at a quiet hour) in which the backend is stopped and the frontend is switched at the end.

| § | Step | What happens | If it goes wrong |
|---|---|---|---|
| [2.1](#21-stop-the-old-backend) | Stop the old backend | The site is down from here on. | Start it again; nothing has changed. |
| [2.2](#22-back-up-the-database-pg_dump) | Back up the database | `pg_dump` of the `public` schema, copied off the box. | Do not continue without a backup. |
| [2.3](#23-pull-install-build) | Pull, install, build | New code on the box. | `git checkout` the old commit. |
| [2.4](#24-migrate-the-database-session-pooler) | Migrate | `prisma migrate deploy` on the Supabase **session pooler**. | Restore the backup. |
| [2.5](#25-look-at-the-accounts) | Look at the accounts | Read-only report. | Nothing to undo. |
| [2.6](#26-regrid-the-map-dry-run-then-apply) | Regrid: dry run, then `--apply` | The dry run prints the plan for 554 → 1000 cells and writes nothing. `--apply` changes the map, in one transaction. | Dry run: nothing to undo. After `--apply`: restore the backup. |
| [2.7](#27-start-the-new-backend) | Start the new backend | pm2 starts it on `127.0.0.1:3000`. | Stop it; if the regrid was applied, restore the backup. |
| [2.8](#28-post-deploy-checks) | Post-deploy checks | One script and a few queries. | Fix, or roll back. |
| [2.9](#29-sandbox-escape-tests) | Sandbox escape tests | Hostile programs against Piston (nobody is on the site yet). | Do not open the demo. |
| [2.10](#210-frontend-on-vercel) | Frontend on Vercel | The new site goes live. The window ends. | Redeploy the previous Vercel build. |

After the regrid is applied (2.6) there is **no code-only rollback**: the old code would show the 554 retired cells next to the 1000 new ones. The way back is the backup ([section 3](#3-if-something-goes-wrong)).

---

## 0. Before the day

### 0.1 Domain and DNS

- An `A` record `api.yourdomain.com` → the instance's **Elastic IP** (attach one in the EC2 console, otherwise the address changes whenever the instance is stopped). The frontend gets its own name on Vercel.
- **Use a real domain, not DuckDNS.** See [section 5](#5-domain-cloudflare-and-why-not-duckdns).

### 0.2 Secrets to rotate or create

Rotate anything that was ever pasted into a chat, an issue, a screenshot or a commit. The repository history holds no real `.env` file (only `.env.example`), but the old source had a **fallback JWT secret** (`dev_secret_change_this_in_production`) in public code, so treat every token signed before this release as forgeable. The new backend refuses that secret, and a new `JWT_SECRET` signs everybody out, which is what you want.

| Secret | Lives in | Do |
|---|---|---|
| `JWT_SECRET` | `/etc/codecraft/backend.env` | **New value.** `openssl rand -base64 48`. At least 32 characters; the server will not start with a short or placeholder one. |
| Google OAuth client secret (`GOOGLE_CLIENT_SECRET`) | env file | Rotate if it was ever shared: Google Cloud Console → APIs & Services → Credentials → your OAuth client → add a new secret, update the env file, restart, then disable the old one. |
| Supabase database password (in `DATABASE_URL`) | env file | Rotate if it was ever shared: Supabase → Project Settings → Database → reset password, then rebuild the URL. |
| Redis Cloud password (in `REDIS_URL`) | env file | Rotate if it was ever shared: Redis Cloud → your database → Security. |
| SSH key of the EC2 box | your computer | Keep it off GitHub and out of chats. |

Nothing else in the project is a secret: Piston's settings (`deploy/piston/limits.env`) are safe to commit, and the browser never holds a key.

### 0.3 Accounts and consoles

- **Google Cloud Console → OAuth consent screen:** set the publishing status to **In production**. While it says "Testing", only the listed test users can sign in and everybody else gets an error. Scopes: `openid`, `email`, `profile` (no verification needed).
- **Credentials → your OAuth client → Authorized redirect URIs:** exactly `https://api.yourdomain.com/auth/google/callback`. It must be the same string as `GOOGLE_CALLBACK_URL` in the env file.
- **Supabase:** the backend connects with a direct Postgres login and does not use the Data API. Switch the Data API off (Project Settings → API) or make sure every table in `public` has row-level security on. Check with `select tablename, rowsecurity from pg_tables where schemaname = 'public';` in the SQL editor. The app's own login keeps working either way.
- **Supabase connection string:** Connect → **Session pooler** (port 5432). Not the transaction pooler (migrations hang or fail on it), not the direct connection (IPv6 only).
- **Redis Cloud:** the free database gives a plain `redis://default:PASSWORD@HOST:PORT` URL. Pick the region nearest the EC2 box. See "Redis Cloud and TLS" in [`docs/security.md`](../docs/security.md).

### 0.4 The EC2 instance

- **Require IMDSv2 and a hop limit of 1.** EC2 console → select the instance → Actions → Instance settings → Modify instance metadata options: IMDSv2 **Required**, response hop limit **1**. (CLI: `aws ec2 modify-instance-metadata-options --instance-id i-... --http-tokens required --http-put-response-hop-limit 1 --http-endpoint enabled`.) Piston runs strangers' code in a privileged container; with hop limit 1 that container cannot reach the metadata service, which is where an attached IAM role's credentials live. If the instance has no IAM role, there is nothing to steal; better still.
- **Security group:** inbound 22 (your IP if you can), 80 and 443. If port 3000 stays open in the group, it does not matter: the backend listens on `127.0.0.1` only. The post-deploy check (2.8) proves that from outside.

---

## 1. Prepare the server (once)

Skip what is already there. Every command is safe to run twice.

### 1.1 Swap (1 GB)

```bash
swapon --show                      # skip this block if a 1 GB swap is already listed
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system >/dev/null
free -h
```

### 1.2 Software

**Use Node 22 (LTS).** The code is built and tested on it; Node 20 is past its end of life and Ubuntu's own `nodejs` package (18) is too old for `--env-file`, which pm2 and the helper scripts rely on (20.6 or newer).

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot git curl docker.io
sudo usermod -aG docker ubuntu        # log out and back in once so the group applies
sudo npm install -g pm2
node --version                        # v22.x
stat -fc %T /sys/fs/cgroup            # cgroup2fs (Ubuntu 22.04 and 24.04 are fine; Piston needs cgroup v2)
```

### 1.3 Folders, the code and the settings file

```bash
sudo install -d -m 755 /etc/codecraft
sudo install -m 600 -o ubuntu -g ubuntu /dev/null /etc/codecraft/backend.env
sudo install -d -o ubuntu -g ubuntu -m 750 /var/log/codecraft

git clone https://github.com/Ajha2005/CodeCraft.git ~/CodeCraft     # a private repo: use a read-only deploy key
cd ~/CodeCraft && git checkout feature/map-guest-security           # "main" once this branch is merged

cp backend/.env.example /etc/codecraft/backend.env
nano /etc/codecraft/backend.env
```

Fill in `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FRONTEND_URL` (the exact origin of the Vercel site, no trailing slash) and `CORS_ORIGINS` (extra allowed origins, or empty). `FRONTEND_URL` and `GOOGLE_CALLBACK_URL` come with `example.com` placeholders: replace them. Leave the rest as it is. `ls -l /etc/codecraft/backend.env` must show `-rw------- ubuntu ubuntu`.

Check that nothing is missing without printing a value:

```bash
cd ~/CodeCraft && deploy/with-prod-env.sh node -e '
for (const k of ["DATABASE_URL","REDIS_URL","JWT_SECRET","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_CALLBACK_URL","FRONTEND_URL"])
  console.log(k.padEnd(22), process.env[k] ? "set" : "MISSING")'
```

There must be **no `backend/.env` on the server**: the app also reads that file and it could silently fill a gap in the real one.

### 1.4 Piston (the code runner)

```bash
cd ~/CodeCraft && deploy/piston/run-piston.sh
```

It creates the `piston-packages` volume and the `piston-api` container (privileged, published on `127.0.0.1:2000` only, memory/process/CPU caps, no network inside the sandbox), installs Python 3.10.0 and gcc 10.2.0 (a few minutes), and checks the result with `docker inspect`. Then:

```bash
curl -s http://127.0.0.1:2000/api/v2/runtimes | head -c 300      # lists python and c++
```

### 1.5 Nginx and the certificate

The real site file cannot load until the certificate exists, so the first certificate is issued while a tiny port-80-only site is enabled. Do the DNS record first (it must point at this box).

```bash
cd ~/CodeCraft
sudo cp deploy/nginx/00-codecraft-http.conf /etc/nginx/conf.d/
sudo rm -f /etc/nginx/sites-enabled/default           # Ubuntu's stock site; two default servers on port 80 break nginx -t
sudo mkdir -p /var/www/certbot

# 1. temporary port-80 site
sed 's/api.example.com/api.yourdomain.com/g' deploy/nginx/bootstrap-http.conf | sudo tee /etc/nginx/sites-available/codecraft-bootstrap.conf >/dev/null
sudo ln -sf /etc/nginx/sites-available/codecraft-bootstrap.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 2. the certificate (renewals reuse the same method)
sudo certbot certonly --webroot -w /var/www/certbot -d api.yourdomain.com -m you@example.com --agree-tos --no-eff-email

# 3. swap the temporary site for the real one
sed 's/api.example.com/api.yourdomain.com/g' deploy/nginx/codecraft-api.conf | sudo tee /etc/nginx/sites-available/codecraft-api.conf >/dev/null
sudo rm /etc/nginx/sites-enabled/codecraft-bootstrap.conf
sudo ln -sf /etc/nginx/sites-available/codecraft-api.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4. certbot renews by itself (a systemd timer); nginx must be reloaded after each renewal
printf '#!/bin/sh\nsystemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

`https://api.yourdomain.com/health` answers `502` until the backend runs (2.7). That is expected. Behind Cloudflare, read [section 5](#5-domain-cloudflare-and-why-not-duckdns) before turning the proxy on.

### 1.6 pm2 survives reboots; logs are rotated

```bash
pm2 startup systemd -u ubuntu --hp /home/ubuntu      # prints one "sudo env PATH=..." line: copy it and run it
pm2 install pm2-logrotate                            # pm2 never rotates logs by itself
```

---

## 2. The release, in order

Open a second terminal on your computer for the checks. Write down the time you stopped the site.

### 2.1 Stop the old backend

```bash
pm2 list                                   # find the old process (its name may differ)
pm2 stop <old-name>                        # or stop whatever runs it: systemd unit, tmux, "npm run start:dev"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health     # 000 = nothing answers
```

Stopping first means the backup is a still picture and nobody writes while the map changes.

### 2.2 Back up the database (`pg_dump`)

```bash
cd ~/CodeCraft && deploy/backup-db.sh
```

It dumps the `public` schema from Supabase through the session pooler (using a throwaway `postgres:17-alpine` container, so the client is never older than the server), refuses a dump that looks empty or wrong, writes it with mode 600 to `~/codecraft-backups/codecraft-<date>.dump`, and prints the row counts of the main tables. **Write those numbers down.** If Supabase runs a newer Postgres than 17, run it with `PG_CLIENT_IMAGE=postgres:18-alpine`. If it stops with `invalid URI query parameter`, the `DATABASE_URL` carries a Prisma-only option (`pgbouncer=true`, `connection_limit=`, `schema=`); this app does not need any, so remove it from the env file.

Then copy the file **off the box**, from your computer (use the Elastic IP, not the API name: behind Cloudflare's proxy the name does not reach port 22):

```bash
scp ubuntu@<the EC2 Elastic IP>:codecraft-backups/codecraft-*.dump .
```

### 2.3 Pull, install, build

```bash
cd ~/CodeCraft
git rev-parse --short HEAD | tee ~/previous-release.txt      # the commit you would go back to
git fetch origin && git checkout feature/map-guest-security && git pull --ff-only
cd backend
npm ci
npm run build                                                # 1 to 3 minutes on this box
ls dist/src/main.js
```

If `npm run build` ends with `Killed`, the 1 GB box ran out of memory (`sudo dmesg | tail` shows the OOM kill). Stop Piston for the minutes the build takes (`docker stop piston-api`, then `docker start piston-api`) and run it again.

### 2.4 Migrate the database (session pooler)

```bash
cd ~/CodeCraft/backend
../deploy/with-prod-env.sh npx prisma migrate status         # which migrations are not applied yet
../deploy/with-prod-env.sh npx prisma migrate deploy
```

`with-prod-env.sh` runs the command with `/etc/codecraft/backend.env` loaded (nothing is printed or exported into your shell). Expect `All migrations have been successfully applied.` Depending on what production already has, up to three migrations are pending: the username column, the contest pledge column, and this release's `grid_version_audit_log` (grid generation + retire marker on cells, the `audit_logs` table, lower-cased emails).

- It hangs and then says `Timed out trying to acquire a postgres advisory lock`: `DATABASE_URL` is the **transaction** pooler (port 6543). Use the session pooler (5432).
- `migrate status` reports a failed migration or drift: **stop** and ask before forcing anything. Each migration runs in a transaction, so a failed one leaves nothing half-applied. If unsure, restore the dump ([section 3](#3-if-something-goes-wrong)).

### 2.5 Look at the accounts

```bash
../deploy/with-prod-env.sh npm run users:report
```

Read-only, prints counts only (never an email or a name). It tells you how many accounts have never signed in with Google. Those still get in: they sign in with Google on the same `@thapar.edu` address, the account, cells and score are kept, and the old password is wiped. The ones that cannot are accounts created with an address that is not a real mailbox; the line "with activity" shows whether any of them matter. Two accounts that differ only by letter case are listed as ambiguous and need merging by hand.

### 2.6 Regrid the map (dry run, then apply)

The map goes from 554 to 1000 cells and every player keeps their territory. Old cells are retired, never deleted.

```bash
../deploy/with-prod-env.sh npm run regrid          # dry run: reads the database, prints the plan, changes nothing
```

Read the end of the output:

```
Cells:            554 live now -> 1000 (554 get retired, none are deleted)
Owned cells:      <n> -> <m>, held by <k> players
Players with fewer cells afterwards: 0
Ownerships that could not be carried over: 0
Open duels:       <a> move to the new cells, <b> are cancelled
```

- The `Database:` line at the top must be your Supabase host on port 5432.
- `Players with fewer cells afterwards` and `Ownerships that could not be carried over` must both be **0**. The number of owned cells goes **up**: one old cell covers about two new ones, and its owner gets all of them. If either number is not 0, stop here.
- Open duels move to the matching new cell, or are cancelled with the reason `REGRID` when there is no match.

Then apply (one transaction with a table lock; it takes seconds, and if it fails nothing has changed):

```bash
../deploy/with-prod-env.sh npm run regrid -- --apply
../deploy/with-prod-env.sh npm run regrid          # run it again: "already on grid version 2 ... Nothing to do."
```

### 2.7 Start the new backend

```bash
cd ~/CodeCraft
pm2 delete codecraft-backend 2>/dev/null; pm2 start deploy/pm2/ecosystem.config.cjs
pm2 save
pm2 logs codecraft-backend --lines 40 --nostream
```

The log should show `Nest application successfully started` and, on a Redis with nothing in it, `The college leaderboard was empty, rebuilt it from the database (N players)`. A line naming a missing or weak setting means the env file needs fixing (the value is never printed).

```bash
ss -ltn | grep ':3000'                              # must say 127.0.0.1:3000, never 0.0.0.0 or *
curl -s http://127.0.0.1:3000/health/ready          # {"status":"ok","db":"up","redis":"up"}
```

### 2.8 Post-deploy checks

**From your computer** (this is what a visitor sees, through DNS, Cloudflare, Nginx and TLS):

```bash
git clone --branch feature/map-guest-security https://github.com/Ajha2005/CodeCraft.git && cd CodeCraft     # or any copy of the repository
node deploy/post-deploy-check.mjs https://api.yourdomain.com \
     --frontend https://app.yourdomain.com --origin-ip <the EC2 public IP>
```

It checks health and readiness, TLS expiry and the http→https redirect, that every non-public route answers 401, that password sign-up is off, that a demo token can be minted, that the map has **1000 cells on grid version 2**, that no response carries an email, hidden test case or id, that a guest cannot write (403), that `/run` works in Python and C++ through Piston, that tokens forged with the old default secret, unsigned tokens and tampered tokens are all rejected, the security headers, CORS for a stranger and for your frontend, that Google sign-in starts with the right redirect URI, that Socket.IO reaches the backend, and that ports 3000 and 2000 are closed from outside. It writes nothing to your database. **0 failed** is the goal; read every warning.

**On the box**, the same facts straight from the database (the row counts come from the backup output in 2.2):

```bash
cd ~/CodeCraft && deploy/with-prod-env.sh docker run --rm -i -e DATABASE_URL postgres:17-alpine \
  sh -c 'exec psql "$DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1' <<'SQL'
SELECT 'live cells (want 1000)' AS what, count(*) AS n FROM territory_cells WHERE "retiredAt" IS NULL
UNION ALL SELECT 'live cells on grid 2 (want 1000)', count(*) FROM territory_cells WHERE "retiredAt" IS NULL AND "gridVersion" = 2
UNION ALL SELECT 'retired cells (the old ones)', count(*) FROM territory_cells WHERE "retiredAt" IS NOT NULL
UNION ALL SELECT 'open ownerships on retired cells (want 0)', count(*) FROM territory_cell_ownerships o JOIN territory_cells c ON c.id = o."cellId" WHERE o."closedAt" IS NULL AND c."retiredAt" IS NOT NULL
UNION ALL SELECT 'cells owned twice (want 0)', count(*) FROM (SELECT "cellId" FROM territory_cell_ownerships WHERE "closedAt" IS NULL GROUP BY "cellId" HAVING count(*) > 1) d
UNION ALL SELECT 'open ownerships (want the "owned cells after" from the regrid)', count(*) FROM territory_cell_ownerships WHERE "closedAt" IS NULL
UNION ALL SELECT 'regrid audit rows (want 1)', count(*) FROM audit_logs WHERE action = 'territory.regrid'
UNION ALL SELECT 'users (same as the backup)', count(*) FROM "User"
UNION ALL SELECT 'submissions (same as the backup)', count(*) FROM submissions;
SQL
```

**In a browser** (a private window): the login page shows its three counters; "Try Demo" opens a read-only session with the banner; the map shows 1000 cells and cannot be changed; **Run** works on a problem and there is no Submit button; "Continue with Google" with a `@thapar.edu` account lands on the map with your own cells highlighted.

### 2.9 Sandbox escape tests

The programs are hostile on purpose (fork bomb, 2 GB memory bomb, 100 MB of output, file and network probes), so run them now, while nobody is on the site. They take a few minutes.

```bash
cd ~/CodeCraft && deploy/escape-tests/run-in-docker.sh        # asks you to type yes
```

Every line must say `PASS`. A `FAIL` means a limit does not hold: do **not** open the demo; fix Piston's flags or limits (`deploy/piston/`) and run it again. What each test does is in [`deploy/escape-tests/README.md`](./escape-tests/README.md). Run them again after any change to the Piston image, flags or limits.

### 2.10 Frontend on Vercel

1. In `frontend/vercel.json`, replace `https://api.example.com` and `wss://api.example.com` in the `connect-src` of the Content-Security-Policy with your API origin (`https://api.yourdomain.com` and `wss://api.yourdomain.com`). Commit and push. (`npm run build` stops with the exact fix if this and `VITE_API_BASE` disagree, so a forgotten edit cannot ship a broken site.)
2. Vercel → your project → Settings: **Root Directory** `frontend`; **Environment Variables** `VITE_API_BASE` = `https://api.yourdomain.com` for Production (and Preview).
3. Deploy. If GitHub auto-deploy does not trigger: `npm install -g vercel`, `vercel login`, `cd frontend && vercel --prod`.
4. Open the live site and do the browser checks from 2.8 again, now through the real frontend. The window is over.

To try the new frontend before the switch, push the branch: Vercel builds a **Preview** for it. Put the preview's origin in `CORS_ORIGINS`, restart the backend, and test the whole flow there first.

---

## 3. If something goes wrong

| Where it stopped | What to do |
|---|---|
| Before 2.4 (nothing in the database changed) | `pm2 start <old-name>`; `git checkout $(cat ~/previous-release.txt)` if you pulled; rebuild if needed. |
| 2.4 failed (migrate) | Each migration is one transaction. Read the message; if it is not obviously harmless, restore the backup (below). |
| 2.6 `--apply` failed | One transaction: nothing changed. Read the message and run it again after fixing the cause, or restore. |
| After 2.6 `--apply`, and the new backend is wrong | The old code cannot read the new map. Restore the backup, then bring the old code back. |

**Restore the backup.** `deploy/restore-db.sh` replaces every table in the `public` schema with the backup (whatever was written since is lost, which is why the backend is stopped first). It checks that the file is a real CodeCraft backup, shows which database it is about to replace and makes you type its name, drops all the tables (so a foreign key a newer migration added cannot block the restore), restores in one transaction and prints the row counts.

```bash
pm2 stop codecraft-backend
cd ~/CodeCraft
deploy/restore-db.sh ~/codecraft-backups/codecraft-YYYYMMDD-HHMMSS.dump      # use your own file name
# compare the row counts it prints with the ones backup-db.sh printed

# the old code
git checkout $(cat ~/previous-release.txt) && cd backend && npm ci && npm run build
cd .. && pm2 start deploy/pm2/ecosystem.config.cjs

# Redis: refill the leaderboard from the restored data
cd backend && ../deploy/with-prod-env.sh npm run leaderboard:rebuild -- --apply --force
```

The restore also puts `_prisma_migrations` back, so `migrate deploy` applies the migrations again on the next attempt (rehearsed: the second attempt gives the same regrid numbers). If the restore itself fails, the tables are already gone and the backup file is untouched: fix the cause it printed and run the script again. Roll the Vercel deployment back too (Deployments → the previous one → Promote to Production) if the new frontend went live.

---

## 4. Day-2

**A code-only update** (no migration): `cd ~/CodeCraft && git pull --ff-only && cd backend && npm ci && npm run build && pm2 restart codecraft-backend`, then the check script. The restart takes a few seconds; in-flight requests finish first (`kill_timeout` is 8 s).

**An update with a migration:** back up first (`deploy/backup-db.sh`), then `../deploy/with-prod-env.sh npx prisma migrate deploy`, then restart. Stop the backend first unless the migration only adds things.

**Looking around**

```bash
pm2 list                                                    # codecraft-backend: online, restarts should stay low
pm2 logs codecraft-backend --lines 100 --nostream           # also /var/log/codecraft/backend.*.log
free -h; sudo dmesg | tail -20                              # memory pressure, OOM kills
docker ps; docker logs --tail 50 piston-api                 # Piston
sudo tail -n 50 /var/log/nginx/error.log
curl -s https://api.yourdomain.com/health/ready
```

- **Uptime monitor:** point a free external monitor (UptimeRobot, Better Stack) at `https://api.yourdomain.com/health/ready`. Nothing else watches the site.
- **Redis restarted or evicted** (the free plan keeps nothing across a restart): the leaderboard is empty until the backend restarts, which refills it from Postgres by itself. By hand: `../deploy/with-prod-env.sh npm run leaderboard:rebuild -- --apply`. Sign-in codes in Redis live 60 seconds, so losing them logs nobody out.
- **Rotating `JWT_SECRET`:** edit the env file, `pm2 restart codecraft-backend`. Everybody is signed out.
- **Changing Piston** (image, flags, `limits.env`): edit, run `deploy/piston/run-piston.sh`, then the escape tests.
- **Many people behind one public IP** (a classroom, a campus network, a demo day): the limits are per IP. If visitors start seeing 429, raise the Nginx zones in `/etc/nginx/conf.d/00-codecraft-http.conf` (`cc_api`, `cc_auth`) and the per-IP limits on the anonymous sign-in routes in `backend/src/auth/auth.controller.ts` (demo sessions 100 an hour, Google sign-in and code exchange 120 a minute). An Nginx 429 has no CORS headers, so the browser reports it as a network error.
- **Scripts that rewrite data** (`npm run reset-grid`, `wipe-territories`, `regrid`) all print a plan and change nothing without `--apply`. Never run one against production without a fresh backup.
- **A brand-new database** (new Supabase project): `migrate deploy`, then `npm run seed`, then `npm run regrid -- --apply`, all through `deploy/with-prod-env.sh`.
- **Disk:** `df -h /`. Docker images and pm2 logs are what grow; `docker image prune` and `pm2-logrotate` keep them in check.

---

## 5. Domain, Cloudflare, and why not DuckDNS

**Do not use a DuckDNS address for the public demo.** Some Indian ISPs (Jio and Airtel among them) block or intercept `duckdns.org` names; the visitor sees a "site not safe" page or nothing at all unless they use a VPN. A recruiter opening your link on a phone network gets that. Buy a real domain (a `.in`, `.xyz` or `.dev` costs a few hundred rupees a year; the GitHub Student Developer Pack gives a free year) and put it on **Cloudflare's free plan**:

1. Add the domain to Cloudflare and change the registrar's nameservers to the two Cloudflare gives you.
2. DNS records: `api` → `A` → the Elastic IP; the frontend name → the target Vercel tells you (leave that one **DNS only**, grey cloud).
3. Issue the Let's Encrypt certificate (section 1.5) while the `api` record is **DNS only**, then switch it to **Proxied** (orange cloud). SSL/TLS mode: **Full (strict)**. Not "Flexible": that sends plain http to port 80 and loops on the redirect.
4. Nginx must see the visitor's real address, not Cloudflare's: refresh the address lists in `deploy/nginx/cloudflare-realip.conf` from <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6>, copy it to `/etc/nginx/snippets/`, uncomment the `include` line in `/etc/nginx/sites-available/codecraft-api.conf` (the installed copy), then `sudo nginx -t && sudo systemctl reload nginx`. Without it every visitor looks like one of Cloudflare's addresses and the per-IP limits hit everybody at once. Keep `TRUST_PROXY_HOPS=1`.
5. Leave **WebSockets** on (the default) and **Bot Fight Mode** off for the API name; it can challenge ordinary API calls.
6. Renewals go through the proxy over HTTP-01. If `sudo certbot renew --dry-run` ever fails once the proxy is on, set the `api` record to DNS only for the renewal, or use a Cloudflare Origin CA certificate instead (it lasts 15 years and needs no renewal).

Then `FRONTEND_URL`, `GOOGLE_CALLBACK_URL`, the Google console redirect URI, `VITE_API_BASE` and the `connect-src` in `frontend/vercel.json` all use the new names.
