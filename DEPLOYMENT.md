# CodeCraft Deployment Guide

## Architecture

| Component | Where | Notes |
|---|---|---|
| Frontend | Vercel | Auto-builds from main branch, root dir = frontend |
| Backend (NestJS) | AWS EC2 (Ubuntu) | Runs via pm2, proxied through Nginx. Config comes from `/etc/codecraft/backend.env` (see "Configuration" below) |
| Piston (code execution) | Same AWS EC2, Docker | Port 2000, needs Python + gcc packages installed |
| PostgreSQL | AWS RDS (`codecraft-db`, ap-south-1) | Database `codecraft`, user `postgres`. TLS with `sslmode=verify-full` and the RDS CA bundle. Previously Supabase |
| Redis | AWS ElastiCache (`codecraft-redis`, ap-south-1) | Plain `redis://host:6379` inside the VPC (no password, no TLS). Previously Redis Cloud (that hostname stopped resolving) and before that Upstash (500k commands/month cap) |
| Domain/SSL | `codecraft-thapar.duckdns.org` (DuckDNS - blocked by some Indian ISPs; a real cheap domain is still wanted) | Nginx + Certbot |

RDS and ElastiCache are only reachable from inside the VPC. Their security groups must allow the EC2 instance's security group on port 5432 (RDS) and 6379 (ElastiCache).

## If the AWS server dies / needs recreating

### 1. Launch new EC2 instance
- Ubuntu Server 24.04 LTS, t3.micro (free tier)
- Reuse existing key pair if possible
- Security group: allow ports 22, 80, 443, 3000
- Storage: 30GB (free tier max)

### 2. Set up swap FIRST (critical - server crashed repeatedly without this)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

### 3. Install everything
sudo apt update
sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
sudo usermod -aG docker ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pm2

Log out/in after the usermod for docker group to apply.

### 4. Domain + SSL
- Point your domain's DNS A record at the new server's IP
- Do NOT use DuckDNS - some Indian ISPs (Jio, Airtel) blocklist duckdns.org domains, causing "site not safe" errors without VPN. Use a real cheap domain instead.
sudo certbot --nginx -d yourdomain.com

### 5. Nginx config (replace /etc/nginx/sites-available/default entirely)

server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com;
    if ($host = yourdomain.com) { return 301 https://$host$request_uri; }
    return 404;
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name yourdomain.com;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

Test + reload: sudo nginx -t && sudo systemctl reload nginx

### 6. Piston setup
docker run -d --name piston-api --restart always -p 2000:2000 --privileged -v piston-packages:/piston/packages ghcr.io/engineer-man/piston
curl -X POST http://localhost:2000/api/v2/packages -H "Content-Type: application/json" -d '{"language": "python", "version": "3.10.0"}'
curl -X POST http://localhost:2000/api/v2/packages -H "Content-Type: application/json" -d '{"language": "gcc", "version": "10.2.0"}'

### 7. Clone repo + install
git clone https://github.com/Ajha2005/CodeCraft.git
cd CodeCraft && git checkout main
cd backend && npm install

### 8. Create the env file (see template below), then:
sudo mkdir -p /etc/codecraft
sudo nano /etc/codecraft/backend.env      # then: sudo chmod 600 /etc/codecraft/backend.env
curl -o ~/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
npx prisma migrate deploy
npm run seed
npx tsx prisma/generate-grid.ts

(If `prisma` or `tsx` complain that `DATABASE_URL` is missing, export it into the shell first, quoted, as shown under "Configuration" below.)

### 9. Start with pm2
Production runs the compiled build, not `start:dev`:

    cd ~/CodeCraft/backend && npm run build
    NODE_ENV=production pm2 start dist/src/main.js --name codecraft-backend \
      --node-args="--env-file=/etc/codecraft/backend.env --max-old-space-size=256" \
      -o /var/log/codecraft/backend.out.log -e /var/log/codecraft/backend.err.log
    pm2 save
    pm2 startup
    pm2 save

(create `/var/log/codecraft` and make it writable by `ubuntu` first.)

## Configuration

The backend reads its settings from `/etc/codecraft/backend.env`, loaded by `node --env-file=`. Three things have caused outages, so read these before changing anything:

1. **Variables pm2 already holds win over the file.** `--env-file` never overrides a variable that is already in the process environment, and pm2 stores the environment it was started with. Editing the file and running a plain `pm2 restart` can therefore leave the OLD value in use. Always check what the running process actually uses:

       tr '\0' '\n' < /proc/$(pm2 pid codecraft-backend)/environ | grep '^DATABASE_URL=' | sed -E 's#(://[^:]+):[^@]*@#\1:****@#'

2. **To change a value:** edit the file, export just that variable into your shell, then restart with `--update-env` and save:

       export DATABASE_URL="$(sudo grep '^DATABASE_URL=' /etc/codecraft/backend.env | cut -d= -f2-)"
       pm2 restart codecraft-backend --update-env && pm2 save

   Keep the quotes around `$(...)`. URLs contain `&`, and an unquoted one (for example from `. /etc/codecraft/backend.env`, or `export X=$(...)` without quotes) makes the shell cut the value at the `&` and run the rest as a background command. That silently drops `sslrootcert` from `DATABASE_URL`.

3. **Never paste terminal output that contains a connection string.** Mask the password first (the `sed` in the command above does that), and rotate it if it was exposed.

Both external services are configured here and nowhere else. If you move the database or Redis, update the file, then do step 2, then verify with the commands in "Health check" below.

## .env template (backend)
DATABASE_URL=          postgresql://postgres:PASSWORD@codecraft-db.<id>.ap-south-1.rds.amazonaws.com:5432/codecraft?sslmode=verify-full&sslrootcert=/home/ubuntu/rds-global-bundle.pem   (RDS rejects / ' " @ in the master password; use letters and numbers so it needs no URL-encoding)
REDIS_URL=             redis://<primary-endpoint>.cache.amazonaws.com:6379   (ElastiCache primary endpoint, no scheme prefix other than redis://. Use rediss:// only if in-transit encryption is turned on for the cache. BullMQ wants maxmemory-policy noeviction on the cache's parameter group)
JWT_SECRET=            generate with: openssl rand -base64 32
JWT_EXPIRES_IN=1d
GOOGLE_CLIENT_ID=      Google Cloud Console -> Credentials
GOOGLE_CLIENT_SECRET=  same place - ROTATE if ever pasted anywhere insecure
GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback
FRONTEND_URL=https://your-vercel-app.vercel.app
APP_TIMEZONE=Asia/Kolkata   optional (this is the default): the campus timezone. The daily solve cap and the streak roll over at midnight here, not at server midnight.

Also update Google Cloud Console -> Credentials -> your OAuth client -> Authorized redirect URIs -> add the GOOGLE_CALLBACK_URL value above.

## Releasing the cell-per-solve / player-colour update

Run `npx prisma migrate deploy` (migration `20261101120000_add_color_index_and_solve_cell`) before starting the new backend. It numbers every existing player (`User.colorIndex`, which fixes their unique map colour) and lets a cell ownership remember the solve that earned it. Solves made before the migration have no recorded cell and show "No cell recorded" on the scoring tab.

Demo mode (no login) uses the same judge queue. It saves nothing and is limited to 30 submissions per 10 minutes per client address. If the API sits behind a reverse proxy, enable Express `trust proxy` so the limit applies per visitor rather than to the proxy as a whole.

## Is there room for everyone's cells?

A solve never takes another player's cell, so each point-earning solve needs a free cell of its own: 100 players solving 100 problems each need 10,000. Check the live map (read-only, changes nothing):

    cd ~/CodeCraft/backend && DATABASE_URL="$(tr '\0' '\n' < /proc/$(pm2 pid codecraft-backend)/environ | grep '^DATABASE_URL=' | cut -d= -f2-)" npx tsx prisma/check-capacity.ts

If it says NOT ENOUGH, the grid needs a smaller cell size (`generate-grid.ts` now defaults to 18, about 11,100 cells; 18.5 gives about 10,600). Rebuilding the grid erases who holds which cell (`reset-grid.ts`). After `generate-grid.ts`, run `npx tsx prisma/backfill-cells.ts` (stop the backend first): it gives every past scored solve a fresh cell, oldest first, so players keep one cell per solved problem. It is safe to run twice. Take an RDS snapshot before rebuilding.

## Known code-level gotchas (already fixed on main, watch for regressions)
- src/common/redis/redis.module.ts - was hardcoded to localhost:6379; must read process.env.REDIS_URL
- src/app.module.ts - BullModule.forRoot() connection was ALSO hardcoded to localhost:6379 separately; must also parse REDIS_URL
- src/main.ts - CORS origin list must include the Vercel frontend URL, not just localhost
- frontend/vercel.json - required for React Router routes (like /auth/callback) to not 404 on Vercel
- package.json was missing point-in-svg-polygon despite code using it - npm install point-in-svg-polygon if generate-grid.ts fails

## Health check

Which endpoints break tells you which dependency is down:

| Symptom | Likely cause |
|---|---|
| `/problems`, `/territories/cells` return 500 | Postgres unreachable or wrong credentials. Logs show Prisma `P1000` (auth failed) or `P1001` (cannot reach) |
| `/leaderboard/college` hangs or 500s, submissions never finish | Redis unreachable. Logs show `getaddrinfo ENOTFOUND` or `ECONNREFUSED` for the Redis host |
| Submissions stay `PENDING`, Redis fine | Piston down: `docker ps`, `curl localhost:2000/api/v2/runtimes` (should list python and gcc) |
| `/` and `/auth/google` work but data endpoints fail | The app is up, a backing service is not. Start with the two rows above |

Quick checks on the server (all passwords masked):

    pm2 logs codecraft-backend --err --lines 60 --nostream | grep -iE "P1000|P1001|ENOTFOUND|ECONN|NOAUTH|WRONGPASS" | tail
    tr '\0' '\n' < /proc/$(pm2 pid codecraft-backend)/environ | grep -E '^(DATABASE_URL|REDIS_URL)=' | sed -E 's#(://[^:]*):[^@]*@#\1:****@#'
    redis-cli -u "$(tr '\0' '\n' < /proc/$(pm2 pid codecraft-backend)/environ | grep '^REDIS_URL=' | cut -d= -f2-)" ping
    psql "$(tr '\0' '\n' < /proc/$(pm2 pid codecraft-backend)/environ | grep '^DATABASE_URL=' | cut -d= -f2-)" -c 'select 1'

An end-to-end test that needs no login: POST a correct solution to `/demo/submissions` and poll `/demo/submissions/<id>` until it reports `AC`. It saves nothing.

## Rebuilding the leaderboard

The college leaderboard lives in Redis (`leaderboard:college`, a sorted set) but the scores come from Postgres: a player's score is the sum of their `performance_scores.totalScore`. If Redis is new or was wiped, reload it from the database (read-only on Postgres):

    psql "$DATABASE_URL" -At -F' ' -c 'select s."userId", sum(p."totalScore") from performance_scores p join submissions s on s.id = p."submissionId" group by s."userId"' \
      | awk '{print "ZADD leaderboard:college "$2" "$1}' \
      | redis-cli -h <elasticache-primary-endpoint> -p 6379

Per-territory leaderboards are not written by the current code, so there is nothing to rebuild for them. Submissions that were queued while Redis was down are lost and stay `PENDING` in the database; those players must resubmit.

## Useful commands for troubleshooting
pm2 list
pm2 logs codecraft-backend --lines 50 --nostream
free -h
sudo dmesg | tail -30
docker ps
curl http://localhost:3000/problems
curl https://yourdomain.com/problems

## Frontend (Vercel)
- Root directory: frontend
- Env var: VITE_API_BASE = backend's HTTPS URL
- If GitHub auto-deploy isn't triggering, deploy manually via CLI:
npm install -g vercel
vercel login
cd frontend
vercel --prod
