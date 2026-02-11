# CORIS — Deployment Guide

Bill tracking application. Manual entry, no bank linking, paycheck-based planning.

## Architecture

```
┌─────────────┐     ┌────────────────┐     ┌──────────────┐
│   Nginx     │────▶│  Node.js API   │────▶│  PostgreSQL  │
│  (static +  │     │  (Fastify)     │     │  16+         │
│   proxy)    │     │  Port 3000     │     │  Port 5432   │
└─────────────┘     └────────────────┘     └──────────────┘
   Port 80/443
```

Frontend: Vanilla HTML/CSS/JS served by Nginx  
Backend: Node.js 20+ / Fastify / TypeScript → compiled to `dist/`  
Database: PostgreSQL 14+ with ledger-safety triggers and views  
Auth: Cookie-based sessions with CSRF protection, bcrypt passwords

## Quick Start (Local Dev)

### 1. Database
```bash
# Install PostgreSQL 14+ and create the database
createdb coris

# Run your Phase 1-4 core schema SQL
psql -d coris -f YOUR_PHASE_1_4_SCHEMA.sql

# Run post-schema migrations (auth + password reset)
psql -d coris -f deploy/migrations/post-schema-migrations.sql
```

### 2. Backend
```bash
cd backend/coris-phase13-backend
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET

npm install
npm run dev
# API running at http://localhost:3000
```

### 3. Frontend
```bash
cd frontend
# Any static server works:
python3 -m http.server 5173
# Open http://localhost:5173
```

### 4. Configure CORS (if different ports)
In `backend/.env`:
```
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

## Production Deployment

### Option A: Deploy Script (VPS)
```bash
cd deploy
cp .env.example .env
# Edit .env with production values (see below)

chmod +x deploy.sh
./deploy.sh
```

### Option B: Manual Steps

#### 1. Set up the server
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y nginx docker.io docker-compose-plugin certbot python3-certbot-nginx
```

#### 2. Clone and configure
```bash
git clone YOUR_REPO /opt/coris
cd /opt/coris/deploy
cp .env.example .env
nano .env  # Fill in all values
```

#### 3. Start services
```bash
docker compose up -d --build
```

#### 4. Run migrations
```bash
# First: run your Phase 1-4 core schema
docker compose exec -T db psql -U coris -d coris < /path/to/phase-1-4-schema.sql

# Then: run post-schema migrations
docker compose exec -T db psql -U coris -d coris < migrations/post-schema-migrations.sql
```

#### 5. Deploy frontend
```bash
sudo mkdir -p /var/www/coris/frontend
sudo rsync -a --delete frontend/ /var/www/coris/frontend/
```

#### 6. Configure Nginx
```bash
sudo cp deploy/nginx-coris.conf /etc/nginx/sites-available/coris
# Edit: replace YOUR_DOMAIN with your actual domain
sudo ln -s /etc/nginx/sites-available/coris /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

#### 7. SSL
```bash
sudo certbot --nginx -d YOUR_DOMAIN
# Then uncomment the HTTPS block in the Nginx config
```

#### 8. Email worker (daily cron)
```bash
crontab -e
# Add:
0 7 * * * cd /opt/coris/deploy && docker compose run --rm api node dist/worker/dueTodayEmail.js >> /var/log/coris-worker.log 2>&1
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Random 64+ character string |
| `PORT` | No | API port (default: 3000) |
| `COOKIE_DOMAIN` | Prod | Your domain (e.g. `coris.app`) |
| `COOKIE_SECURE` | Prod | `true` in production (requires HTTPS) |
| `CSRF_ENABLED` | No | `true` by default |
| `CORS_ALLOWED_ORIGINS` | Dev | Frontend URL if on different port |
| `APP_PUBLIC_URL` | Yes | Full URL (e.g. `https://coris.app`) |
| `SMTP_HOST` | Email | SMTP server hostname |
| `SMTP_PORT` | Email | SMTP port (usually 587) |
| `SMTP_USER` | Email | SMTP username |
| `SMTP_PASS` | Email | SMTP password |
| `SMTP_FROM` | Email | From address for emails |

## File Structure

```
coris/
├── backend/coris-phase13-backend/
│   ├── src/
│   │   ├── server.ts          # Fastify app entry
│   │   ├── routes/            # API route handlers
│   │   ├── lib/               # Auth, DB, CORS, errors
│   │   └── worker/            # Due-today email worker
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── index.html             # Landing page
│   ├── contact.html           # Contact form
│   ├── css/shared.css         # Design system (Mint Teal)
│   ├── css/landing.css        # Landing-specific styles
│   ├── js/shared.js           # Auth, modals, toasts, API helpers
│   ├── app/                   # Authenticated pages
│   │   ├── dashboard.html
│   │   ├── templates.html
│   │   ├── schedule.html
│   │   ├── bills.html
│   │   ├── planning.html
│   │   ├── reminders.html
│   │   ├── onboarding.html
│   │   ├── settings.html
│   │   ├── login.html
│   │   ├── signup.html
│   │   ├── forgot-password.html
│   │   └── reset-password.html
│   ├── legal/                 # Terms, Privacy, Disclaimer
│   └── assets/                # Logo, SVGs
├── deploy/
│   ├── Dockerfile.api
│   ├── docker-compose.yml
│   ├── nginx-coris.conf
│   ├── .env.example
│   ├── deploy.sh
│   └── migrations/
│       └── post-schema-migrations.sql
└── README.md                  # This file
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/auth/signup` | No | Create account |
| POST | `/v1/auth/login` | No | Log in (sets cookie) |
| GET | `/v1/auth/me` | Yes | Current user |
| POST | `/v1/auth/logout` | Yes | Log out (clears cookie) |
| POST | `/v1/auth/forgot-password` | No | Request reset email |
| POST | `/v1/auth/reset-password` | No | Reset password with token |
| GET | `/v1/templates/me` | Yes | List bill templates |
| POST | `/v1/templates` | Yes | Create template |
| PATCH | `/v1/templates/:id` | Yes | Update template |
| POST | `/v1/templates/:id/deactivate` | Yes | Deactivate template |
| GET | `/v1/occurrences/me` | Yes | List all occurrences |
| POST | `/v1/occurrences/:id/paid` | Yes | Mark occurrence paid |
| PATCH | `/v1/occurrences/:id/amount` | Yes | Edit variable amount |
| GET | `/v1/schedule/me` | Yes | Get pay schedule |
| POST | `/v1/schedule/set` | Yes | Set/update pay schedule |
| POST | `/v1/schedule/regenerate` | Yes | Regenerate planning windows |
| GET | `/v1/planning/windows` | Yes | List paycheck windows |
| GET | `/v1/planning/window/:id/items` | Yes | Bills in a window |
| GET | `/v1/planning/integrity` | Yes | Check for unassigned bills |
| GET | `/v1/reminders/pending` | Yes | Pending reminders |
| GET | `/v1/reminders/upcoming` | Yes | Upcoming reminders |
| POST | `/v1/reminders/generate` | Yes | Generate new reminders |
| GET | `/health` | No | Health check |

## Verification

After deployment, check:

```bash
# API health
curl https://YOUR_DOMAIN/health
# → {"ok":true}

# Frontend loads
curl -sI https://YOUR_DOMAIN/ | head -5
# → HTTP/2 200

# Database connected (check API logs)
docker compose logs api --tail 20
```
