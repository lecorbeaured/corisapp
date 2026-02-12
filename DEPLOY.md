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

## STEP 2: Railway — Set Up the Database

You already have PostgreSQL provisioned on Railway. Now you need to:
- Get the connection details from Railway
- Connect pgAdmin to it
- Run the SQL that creates all the tables CORIS needs

### 2A: Get connection details from Railway

1. Open your Railway project
2. Click on the **PostgreSQL** service (the database icon)
3. Click the **Variables** tab
4. You'll see a list of environment variables. Find and copy these 5 values somewhere safe (a notepad):

   | Variable | What it is | Example |
   |---|---|---|
   | `PGHOST` | Server address | `roundhouse.proxy.rlwy.net` |
   | `PGPORT` | Port number | `54312` |
   | `PGUSER` | Username | `postgres` |
   | `PGPASSWORD` | Password | `aBcDeFgHiJkL123` |
   | `PGDATABASE` | Database name | `railway` |

   Also copy the full `DATABASE_URL` — you'll need it in Step 3.

### 2B: Connect pgAdmin to Railway

1. Open **pgAdmin** on your computer
2. In the left sidebar, right-click **"Servers"** → **Register** → **Server...**
3. A dialog box opens with tabs. Fill in:

   **General tab:**
   - **Name:** `CORIS Railway` (this is just a label, call it whatever you want)

   **Connection tab:**
   - **Host name/address:** paste your `PGHOST` value (e.g. `roundhouse.proxy.rlwy.net`)
   - **Port:** paste your `PGPORT` value (e.g. `54312`)
   - **Maintenance database:** paste your `PGDATABASE` value (e.g. `railway`)
   - **Username:** paste your `PGUSER` value (e.g. `postgres`)
   - **Password:** paste your `PGPASSWORD` value
   - **Save password?** check this box so you don't have to re-enter it

4. Click **Save**
5. In the left sidebar, you should now see **CORIS Railway** under Servers. Click the arrow to expand it. If it connects successfully, you'll see your database listed.

### 2C: Open the Query Tool

1. In the left sidebar, expand: **CORIS Railway** → **Databases** → **railway** (or whatever your `PGDATABASE` is)
2. Click on the database name **railway** to select it (it should be highlighted)
3. In the top menu, click **Tools** → **Query Tool**
4. A blank SQL editor opens on the right side — this is where you'll paste and run SQL

### 2D: Run the schema SQL

You need to run SQL in **two batches**. Do them in order.

**Batch 1: Core schema**

This file creates all the tables, views, functions, and triggers CORIS needs.

1. Open the file `deploy/schema.sql` from the zip in a text editor
2. Select all → Copy
3. Go back to pgAdmin's Query Tool
4. Paste it into the SQL editor
5. Click the **▶ Execute** button (play button) in the toolbar, or press **F5**
6. You should see "Commands completed successfully" at the bottom

**Batch 2: Auth & password reset migrations**

1. Clear the query editor (select all → delete)
2. Open the file `deploy/migrations/post-schema-migrations.sql` from the zip in a text editor
3. Copy the entire contents
4. Paste into the pgAdmin query editor
5. Click **▶ Execute** (or F5)
6. You should see "Commands completed successfully" again

### 2E: Verify everything was created

1. Clear the query editor
2. Paste this and execute:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

3. You should see these tables in the results:

```
bill_occurrences
bill_templates
password_resets
pay_schedules
paycheck_windows
reminders
users
```

If you see all 7 tables, your database is ready. Move on to Step 3.

**If something went wrong:**
- If you see an error like "relation already exists" — that's fine, it means the table was already created
- If you see "syntax error" — make sure you copied the entire SQL file, not just part of it
- If pgAdmin won't connect — double-check the host, port, username, and password from Railway. Make sure there are no extra spaces when you paste

---

## STEP 3: Railway — Backend API

1. In the same Railway project, click **"New"** → **"GitHub Repo"**
2. Select your `coris` repo
3. Railway auto-detects Node.js. Go to **Settings** tab:

   **Root Directory:** `backend`
   
   **Build Command:** `npm install --include=dev && npm run build`
   
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
