# CodeCraft Deployment Guide

## Architecture

| Component | Where | Notes |
|---|---|---|
| Frontend | Vercel | Auto-builds from main branch, root dir = frontend |
| Backend (NestJS) | AWS EC2 (Ubuntu) | Runs via pm2, proxied through Nginx |
| Piston (code execution) | Same AWS EC2, Docker | Port 2000, needs Python + gcc packages installed |
| PostgreSQL | Supabase | Free tier |
| Redis | Redis Cloud (redis.io) | Free tier: 30MB storage limit, no command-count cap. Previously Upstash (500k commands/month cap - hit this limit, switched providers) |
| Domain/SSL | TBD - was DuckDNS, blocked by some Indian ISPs; needs a real cheap domain | Nginx + Certbot |

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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

### 8. Create .env (see template below), then:
npx prisma migrate deploy
npm run seed
npx tsx prisma/generate-grid.ts

### 9. Start with pm2
pm2 start npm --name codecraft-backend -- run start:dev
pm2 save
pm2 startup
pm2 save

## .env template (backend)
DATABASE_URL=          Supabase -> Connect -> Session pooler. NOT Transaction pooler (migrations fail). NOT Direct connection (IPv6-only, unreachable from most VPS).
REDIS_URL=             Redis Cloud dashboard -> Data Access or Configuration tab -> use the plain redis://default:PASSWORD@host:port URL, NOT the redis-cli command shown alongside it
JWT_SECRET=            generate with: openssl rand -base64 32
JWT_EXPIRES_IN=1d
GOOGLE_CLIENT_ID=      Google Cloud Console -> Credentials
GOOGLE_CLIENT_SECRET=  same place - ROTATE if ever pasted anywhere insecure
GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback
FRONTEND_URL=https://your-vercel-app.vercel.app
TRUST_PROXY_HOPS=1     number of proxies in front of the API (Nginx = 1); see "Demo mode" below. Do not set it if nothing is in front of the API.
PISTON_URL=            optional, defaults to http://localhost:2000
PISTON_MAX_CONCURRENCY=2   optional (1-8), defaults to 2, which is right for a 1 GB box

Also update Google Cloud Console -> Credentials -> your OAuth client -> Authorized redirect URIs -> add the GOOGLE_CALLBACK_URL value above.

## Demo mode ("Try the demo" + Run examples)

What it is and what a visitor can do: see "Demo Mode" in the README. This is what it needs from the server.

### Deploying it
1. `cd backend && npm install` (new dependency: @nestjs/throttler, which wants Node 20.19 or newer: check `node -v`, and re-run the NodeSource setup line from step 3 if the server is older), then restart: `pm2 restart codecraft-backend`
2. Nginx must pass the visitor's address on (the `X-Forwarded-For` line in step 5 above), and `.env` must say `TRUST_PROXY_HOPS=1`. Then: `sudo nginx -t && sudo systemctl reload nginx`
   - Without both, every visitor looks like 127.0.0.1 and all demo visitors share ONE rate-limit bucket (10 runs a minute between them).
   - If another proxy or CDN sits in front of Nginx, count it (`TRUST_PROXY_HOPS=2`). Never set it higher than the real number of proxies: a visitor could then pick their own "IP" with an `X-Forwarded-For` header and slip past the limits.
3. Close port 3000 in the EC2 security group once Nginx + SSL work (the Vercel frontend talks to the API through 443). With `TRUST_PROXY_HOPS=1` the API believes the address Nginx appends, so anyone who can reach port 3000 directly can pick their own address and dodge the per-IP limits. Port 2000 (Piston) must never be reachable from outside either.
4. No database change is needed.

### Limits (all optional)
| Variable | Default | What it does |
|---|---|---|
| PISTON_MAX_CONCURRENCY | 2 (1-8) | Programs running at once, across submissions and Run clicks. The box has 1 GB |
| RUN_MAX_QUEUE | 20 | Run clicks allowed to wait for a free slot; more get a quick 503 "code runner is busy" |
| RUN_MAX_WAIT_MS | 30000 | How long a Run click may wait for a slot before it gets that 503 |
| JUDGE_RUN_TIMEOUT_MS, JUDGE_COMPILE_TIMEOUT_MS, JUDGE_RUN_CPU_MS, JUDGE_COMPILE_CPU_MS | 3000 / 10000 / 3000 / 10000 for Run clicks | Time caps. Graded submissions send none (Piston's own defaults), unless you set a value, which then applies to them too |
| JUDGE_RUN_MEMORY_BYTES, JUDGE_COMPILE_MEMORY_BYTES | 128 MB / 384 MB for Run clicks | Memory caps, same rule |

Rate limits (fixed in code): `POST /run` 10 a minute per IP for demo visitors and 30 a minute per account for signed-in users; `POST /auth/guest` 100 an hour per IP. No other route has a rate limit yet. A demo visitor holds at most one execution slot, and waiting runs are served graded submissions first, signed-in users next, demo visitors last, so a flood of demo runs can delay a student's submission by one run at most.

### Things to know
- Run the backend as ONE process (as step 9 does). The rate-limit counters and the slot limiter live in that process's memory; a second instance would enforce its own limits and double them. Move them to Redis before scaling out.
- The old `/judge/run`, `/judge/test-one` and `/judge/test-all` HTTP routes are gone: they ran anyone's code with no login and no limit. The grader and `POST /run` call the judge service directly.
- Quick check after deploying (token first, then a run, then a refused write):
  - `curl -s -X POST https://yourdomain.com/auth/guest` returns `{"accessToken": ..., "role": "GUEST", "expiresIn": 7200}`
  - `curl -s -X POST https://yourdomain.com/run -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"problemId": ID, "language": "python", "code": "def solve(*a):\n    return 0"}'` answers 200 with one result per example
  - the same token on `POST /submissions` answers 403 "Demo mode is read-only. Sign in with a Thapar ID to do this."

## Known code-level gotchas (already fixed on main, watch for regressions)
- src/common/redis/redis.module.ts - was hardcoded to localhost:6379; must read process.env.REDIS_URL
- src/app.module.ts - BullModule.forRoot() connection was ALSO hardcoded to localhost:6379 separately; must also parse REDIS_URL
- src/main.ts - CORS origin list must include the Vercel frontend URL, not just localhost
- frontend/vercel.json - required for React Router routes (like /auth/callback) to not 404 on Vercel
- package.json was missing point-in-svg-polygon despite code using it - npm install point-in-svg-polygon if generate-grid.ts fails

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
