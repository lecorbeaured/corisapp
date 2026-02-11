# CORIS Deployment Guide
## Railway (Backend) + Netlify (Frontend)

---

## STEP 1: Push to GitHub

You need ONE repo with this structure:

```
coris/
├── backend/          ← Railway deploys this
├── frontend/         ← Netlify deploys this
├── deploy/
└── README.md
```

```bash
cd coris
git init
git add .
git commit -m "CORIS v1 — production ready"
git remote add origin https://github.com/YOUR_USERNAME/coris.git
git branch -M main
git push -u origin main
```

---

## STEP 2: Railway — PostgreSQL Database

1. Go to https://railway.app → **New Project**
2. Click **"Provision PostgreSQL"**
3. Once created, click the PostgreSQL service → **Variables** tab
4. Copy the `DATABASE_URL` value (you'll need this in Step 3)
5. Click **Data** tab → **Query** → paste and run your schema SQL:
   - First: run your original Phase 1–4 schema SQL (the one that creates tables, views, functions, triggers)
   - Then: run `deploy/migrations/post-schema-migrations.sql` (adds auth columns + password reset table)
6. Verify in the Query tab:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
   ```
   You should see: `bill_occurrences`, `bill_templates`, `password_resets`, `pay_schedules`, `paycheck_windows`, `reminders`, `users`

---

## STEP 3: Railway — Backend API

1. In the same Railway project, click **"New"** → **"GitHub Repo"**
2. Select your `coris` repo
3. Railway auto-detects Node.js. Go to **Settings** tab:

   **Root Directory:** `backend`
   
   **Build Command:** `npm install && npm run build`
   
   **Start Command:** `npm start`

4. Go to **Variables** tab and add these environment variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | *(paste from Step 2)* |
   | `JWT_SECRET` | *(generate: run `openssl rand -hex 32` in terminal)* |
   | `PORT` | `3000` |
   | `NODE_ENV` | `production` |
   | `CORS_ALLOWED_ORIGINS` | `https://YOUR-SITE.netlify.app` |
   | `CORS_ALLOW_ALL` | `false` |
   | `COOKIE_SECURE` | `true` |
   | `COOKIE_DOMAIN` | *(leave empty for now)* |
   | `CSRF_ENABLED` | `true` |

   **For email reminders (optional, add later):**
   | `SMTP_HOST` | `smtp.gmail.com` (or your provider) |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | `your-email@gmail.com` |
   | `SMTP_PASS` | `your-app-password` |
   | `SMTP_FROM` | `CORIS <noreply@coris.app>` |

5. Click **Deploy** → wait for build to finish (usually 1–2 minutes)

6. Go to **Settings** → **Networking** → **Generate Domain**
   - Railway gives you something like: `coris-api-production.up.railway.app`
   - **Copy this URL** — you need it for Netlify

7. **Test the API:**
   ```
   https://coris-api-production.up.railway.app/health
   ```
   Should return: `{"status":"ok"}`

---

## STEP 4: Netlify — Frontend

1. Go to https://app.netlify.com → **Add new site** → **Import an existing project**
2. Connect to GitHub → select your `coris` repo
3. Configure build settings:

   **Base directory:** `frontend`
   
   **Build command:** *(leave empty — it's static HTML)*
   
   **Publish directory:** `frontend`

4. Click **Deploy site**

5. **CRITICAL: Update the API proxy.** Go to your repo and edit `frontend/netlify.toml`:

   Replace BOTH instances of `YOUR_API_URL` with your Railway URL:

   ```toml
   [[redirects]]
     from = "/v1/*"
     to = "https://coris-api-production.up.railway.app/v1/:splat"
     status = 200
     force = true

   [[redirects]]
     from = "/health"
     to = "https://coris-api-production.up.railway.app/health"
     status = 200
     force = true
   ```

6. Commit and push — Netlify auto-redeploys on push.

7. Your site is now live at: `https://YOUR-SITE.netlify.app`

---

## STEP 5: Connect the dots

Now that both are live, update these values:

### A. Railway — Update CORS origin
Go to Railway → Backend service → Variables:
```
CORS_ALLOWED_ORIGINS = https://YOUR-SITE.netlify.app
```

### B. Railway — Update Cookie Domain (if using custom domain later)
Leave `COOKIE_DOMAIN` empty for now. Cookies will be set on the Netlify domain.

### C. Test the full flow
1. Open `https://YOUR-SITE.netlify.app`
2. Click "Get started" → create an account
3. Complete onboarding → set pay schedule → add a bill
4. Go to Dashboard → verify data loads
5. Go to Planning → verify windows generated

---

## STEP 6: Custom Domain (Optional)

### Netlify (frontend):
1. **Domain settings** → **Add custom domain** → `coris.app` (or your domain)
2. Add DNS records as Netlify instructs (usually a CNAME or A record)
3. Enable HTTPS (automatic via Let's Encrypt)

### Railway (backend):
1. **Settings** → **Networking** → **Custom Domain** → `api.coris.app`
2. Add a CNAME DNS record: `api.coris.app` → Railway's provided domain

### Then update:
- `netlify.toml`: change `YOUR_API_URL` to `https://api.coris.app`
- Railway `CORS_ALLOWED_ORIGINS`: change to `https://coris.app`
- Railway `COOKIE_DOMAIN`: set to `.coris.app` (note the leading dot — allows cookies across subdomains)

---

## STEP 7: Google Analytics

Replace `G-XXXXXXXXXX` with your real GA4 Measurement ID.

1. Go to https://analytics.google.com → Create property → Get Measurement ID (starts with `G-`)
2. Find and replace across all HTML files:
   ```bash
   # In your local repo:
   grep -rl "G-XXXXXXXXXX" frontend/ | xargs sed -i 's/G-XXXXXXXXXX/G-YOUR-REAL-ID/g'
   ```
3. Commit and push.

---

## STEP 8: Sitemap & SEO

1. Update `frontend/sitemap.xml` — replace `coris.app` with your actual domain if different
2. Submit sitemap to Google Search Console:
   - Go to https://search.google.com/search-console
   - Add your domain
   - Go to Sitemaps → enter `https://yourdomain.com/sitemap.xml` → Submit
3. Submit to Bing Webmaster Tools too (https://www.bing.com/webmasters)

---

## Troubleshooting

**API calls fail (CORS errors):**
- Check Railway `CORS_ALLOWED_ORIGINS` matches your Netlify URL exactly (including `https://`)
- Check `netlify.toml` has the correct Railway URL

**Login works but redirects back to login:**
- Cookie not setting. Check Railway `COOKIE_SECURE=true`
- Make sure your Netlify site is on HTTPS (it should be by default)

**Favicon still showing old one:**
- Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
- Or clear browser cache entirely

**Railway build fails:**
- Check Root Directory is set to `backend`
- Check `package.json` has `"type": "module"` and correct scripts

**"Missing JWT_SECRET" error on Railway:**
- Make sure you added the `JWT_SECRET` environment variable in Railway

---

## Environment Variables Quick Reference

| Variable | Where | Example |
|---|---|---|
| `DATABASE_URL` | Railway | `postgresql://user:pass@host:5432/railway` |
| `JWT_SECRET` | Railway | `a1b2c3...` (64 char hex) |
| `PORT` | Railway | `3000` |
| `NODE_ENV` | Railway | `production` |
| `CORS_ALLOWED_ORIGINS` | Railway | `https://coris.netlify.app` |
| `COOKIE_SECURE` | Railway | `true` |
| `COOKIE_DOMAIN` | Railway | *(empty or `.coris.app`)* |
| `CSRF_ENABLED` | Railway | `true` |
| `YOUR_API_URL` in netlify.toml | Netlify repo | `https://coris-api-production.up.railway.app` |
| `G-XXXXXXXXXX` in HTML files | Netlify repo | `G-ABC123DEF4` |
