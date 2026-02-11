#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════
# CORIS Deploy Helper
# Run on your VPS after cloning the repo.
# ═══════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$SCRIPT_DIR"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
NGINX_CONF="/etc/nginx/sites-available/coris"
WEB_ROOT="/var/www/coris/frontend"

echo "═══════════════════════════════════"
echo "  CORIS Deployment"
echo "═══════════════════════════════════"
echo ""

# ── Check prerequisites ──
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "✗ Missing: $1"
    echo "  Install it first, then re-run."
    exit 1
  fi
  echo "✓ $1 found"
}

echo "Checking prerequisites..."
check_cmd docker
check_cmd nginx
check_cmd node
echo ""

# ── Step 1: Env file ──
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "→ Copying .env.example to .env"
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  echo ""
  echo "  ⚠  IMPORTANT: Edit deploy/.env with your real values:"
  echo "     - DATABASE_URL / DB_PASSWORD"
  echo "     - JWT_SECRET (generate a random string)"
  echo "     - COOKIE_DOMAIN (your domain, no protocol)"
  echo "     - APP_PUBLIC_URL (your full https URL)"
  echo "     - SMTP_* (for email functionality)"
  echo ""
  echo "  Then re-run this script."
  exit 0
fi

echo "✓ .env file exists"
echo ""

# ── Step 2: Docker services ──
echo "→ Starting database and API..."
cd "$DEPLOY_DIR"
docker compose up -d --build
echo "✓ Docker services started"
echo ""

# Wait for DB
echo "→ Waiting for PostgreSQL..."
sleep 5
until docker compose exec -T db pg_isready -U coris &>/dev/null; do
  sleep 2
done
echo "✓ PostgreSQL is ready"
echo ""

# ── Step 3: Run migrations ──
echo "→ Running migrations..."
echo "  NOTE: You must run your Phase 1-4 core schema SQL first."
echo "  Then run the post-schema migrations:"
echo ""
echo "  docker compose exec -T db psql -U coris -d coris < migrations/post-schema-migrations.sql"
echo ""

# ── Step 4: Frontend deployment ──
echo "→ Deploying frontend to $WEB_ROOT..."
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$FRONTEND_DIR/" "$WEB_ROOT/"
echo "✓ Frontend deployed"
echo ""

# ── Step 5: Nginx config ──
echo "→ Installing Nginx config..."
sudo cp "$DEPLOY_DIR/nginx-coris.conf" "$NGINX_CONF"
if [ ! -L "/etc/nginx/sites-enabled/coris" ]; then
  sudo ln -s "$NGINX_CONF" /etc/nginx/sites-enabled/coris
fi
sudo nginx -t && sudo systemctl reload nginx
echo "✓ Nginx configured and reloaded"
echo ""

# ── Step 6: SSL ──
echo "→ SSL setup"
echo "  Run certbot for HTTPS:"
echo "  sudo certbot --nginx -d YOUR_DOMAIN"
echo "  Then uncomment the HTTPS block in $NGINX_CONF"
echo ""

# ── Step 7: Due-today worker cron ──
echo "→ Email worker"
echo "  Add to crontab for daily due-today emails:"
echo "  0 7 * * * cd $DEPLOY_DIR && docker compose run --rm api node dist/worker/dueTodayEmail.js >> /var/log/coris-worker.log 2>&1"
echo ""

# ── Done ──
echo "═══════════════════════════════════"
echo "  Deployment complete!"
echo "═══════════════════════════════════"
echo ""
echo "  API:      http://localhost:3000/health"
echo "  Frontend: http://YOUR_DOMAIN"
echo ""
echo "  Next steps:"
echo "  1. Edit deploy/.env with production values"
echo "  2. Run Phase 1-4 core schema SQL"
echo "  3. Run post-schema migrations"
echo "  4. Set up SSL with certbot"
echo "  5. Update YOUR_DOMAIN in nginx config"
echo "  6. Set up cron for email worker"
