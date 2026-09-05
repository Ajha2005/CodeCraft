# CodeCraft Deployment Guide

## Architecture

| Component | Where | Notes |
|---|---|---|
| Frontend | Vercel | Auto-builds from main branch, root dir = frontend |
| Backend (NestJS) | AWS EC2 (Ubuntu) | Runs via pm2, proxied through Nginx |
| Piston (code execution) | Same AWS EC2, Docker | Port 2000, needs Python + gcc packages installed |
| PostgreSQL | Supabase | Free tier |
| Redis | Upstash | Free tier, used for BullMQ queue + leaderboard cache |
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
REDIS_URL=             Upstash dashboard -> copy the plain rediss URL, NOT the redis-cli command shown alongside it
JWT_SECRET=            generate with: openssl rand -base64 32
JWT_EXPIRES_IN=1d
GOOGLE_CLIENT_ID=      Google Cloud Console -> Credentials
GOOGLE_CLIENT_SECRET=  same place - ROTATE if ever pasted anywhere insecure
GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback
FRONTEND_URL=https://your-vercel-app.vercel.app

Also update Google Cloud Console -> Credentials -> your OAuth client -> Authorized redirect URIs -> add the GOOGLE_CALLBACK_URL value above.

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
