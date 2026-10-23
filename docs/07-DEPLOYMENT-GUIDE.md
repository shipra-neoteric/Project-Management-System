# 07 — Deployment Guide (all free tiers)

Order: **MongoDB Atlas → GitHub → Render (backend) → Vercel (frontend) → back to Render to set the frontend URL.**

## 1. MongoDB Atlas (database)

1. Sign in at <https://cloud.mongodb.com> → **Create** a cluster → choose **M0 Free**, any nearby region (e.g. Mumbai `ap-south-1`).
2. **Database Access** → *Add New Database User* → username + strong password (role: *Read and write to any database*).
3. **Network Access** → *Add IP Address* → `0.0.0.0/0` (Render's free tier has no fixed IP).
4. **Connect** → *Drivers* → copy the connection string and add the database name `pms`:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/pms?retryWrites=true&w=majority`

## 2. GitHub

From `project-management-system/`:

```bash
git init
git add .
git commit -m "Initial commit: Project Management System"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env` files are git-ignored — never commit real secrets.

## 3. Render (backend API)

1. <https://render.com> → sign in with GitHub → **New → Web Service** → pick the repo.
2. Settings:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Instance Type | **Free** |
| Health Check Path | `/api/health` |

3. Environment variables:

| Key | Value |
|---|---|
| `MONGODB_URI` | the Atlas string from step 1 |
| `JWT_SECRET` | a long random string (40+ chars) |
| `FRONTEND_URL` | `http://localhost:3000` for now — updated in step 5 |
| `NODE_VERSION` | `24` |

4. Deploy → copy the URL, e.g. `https://pms-api.onrender.com`. Check `https://pms-api.onrender.com/api/health` returns `{"ok":true,…}`.

## 4. Vercel (frontend)

1. <https://vercel.com> → sign in with GitHub → **Add New → Project** → import the repo.
2. **Root Directory:** `frontend` (Framework preset: Next.js is auto-detected).
3. Environment variable: `NEXT_PUBLIC_API_URL` = `https://pms-api.onrender.com/api`
4. Deploy → you get `https://<project>.vercel.app`.

## 5. Connect them

Back in Render → Environment → set `FRONTEND_URL` to the Vercel URL (comma-separate several, e.g. `https://pms.vercel.app,http://localhost:3000`). Render redeploys automatically.

## 6. First login

Open the Vercel URL → **Register**. The **first account becomes Admin**. Teammates register themselves; add them to projects from *Project → Settings → Members*.

## 6b. Email (optional, free)

Without SMTP the app works fully, but emails (notifications, password reset, email confirmation) are only written to the Render log. To send real emails, add these to Render → Environment:

| Key | Example |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` (Brevo free plan: 300 emails/day) or `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` / `SMTP_PASS` | your SMTP login (for Gmail: an *app password*) |
| `MAIL_FROM` | `Project Management System <pms@yourcompany.com>` |
| `APP_URL` | your Vercel URL, used in email links (defaults to the first `FRONTEND_URL`) |

Attachments are stored in MongoDB Atlas (GridFS). The free M0 cluster has 512 MB, so keep an eye on usage if teams upload many large files.

## 7. Updating

`git push` to `main` → Render and Vercel both redeploy automatically.

## Free-tier notes
* Render Free sleeps after 15 minutes idle; the first request after that takes ~30–60 s (the app shows a "waking up" banner). For a demo, open the site a minute before presenting. Optional: a free uptime monitor (e.g. UptimeRobot) pinging `/api/health` every 10 minutes keeps it awake.
* Atlas M0 is free forever with 512 MB storage.
