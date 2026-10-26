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

## 6c. Single sign-on (optional) — Nexora, Microsoft, Google, Keycloak…

PMS supports **OpenID Connect** (authorization code flow with PKCE). When it is configured, the login page shows a **“Sign in with &lt;name&gt;”** button.

**1. Register PMS as an application in your identity provider** (for Nexora: in its admin/OAuth client settings):

| Setting | Value |
|---|---|
| Application type | Web application (confidential client, has a client secret) |
| Redirect / callback URI | `https://<your-render-api>.onrender.com/api/auth/sso/callback` |
| Scopes | `openid email profile` |
| Grant type | Authorization code (PKCE S256 is sent; the client secret is sent in the request body — `client_secret_post`) |

**2. Add these environment variables on Render** (Environment tab), then redeploy:

| Variable | Example |
|---|---|
| `OIDC_ISSUER` | `https://login.nexora.example.com` — the issuer URL; `<issuer>/.well-known/openid-configuration` must exist |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | from step 1 |
| `OIDC_DISPLAY_NAME` | `Nexora` (button label) |
| `OIDC_AUTO_CREATE_USERS` | `true` to create an account on first sign-in; `false` (default) = only existing or invited users |
| `OIDC_ALLOWED_DOMAINS` | `neotericgrp.in` (comma-separated; empty = any) |
| `OIDC_REDIRECT_URI` | only if the API sits behind another domain/proxy |

**How accounts are matched:** by the provider’s user id (`sub`); on first sign-in, an existing PMS account with the same **verified** email is linked automatically (including pending invitations). Deactivated users cannot sign in. People who sign in with SSO skip the app’s own two-factor step — the provider’s MFA applies.

**What Nexora must support:** an OpenID Connect discovery document, the authorization code flow, signed ID tokens (RS256/ES256 via a JWKS endpoint) containing `sub`, `email` and ideally `email_verified` and `name`. If Nexora only offers a custom login (no OpenID Connect), a small bridge would be needed instead.

## 6d. Two-factor authentication, API tokens and webhooks

- **Two-factor authentication:** each user turns it on under **My profile** (any authenticator app; 10 one-time backup codes). Administrators can require it for everyone under **Organisation → Security** and reset it for someone who lost their phone (`POST /api/auth/2fa/reset/:userId`).
- **API tokens:** **My profile → API tokens** (read-only or read & write, optional expiry). The API is described at `/api/openapi.json` and in the app under **API docs**.
- **Webhooks:** **Admin → Webhooks**. URLs must use `https://`; private network addresses are blocked in production. Each request is signed (`X-PMS-Signature: sha256=<HMAC of the body>`).

## 7. Updating

`git push` to `main` → Render and Vercel both redeploy automatically.

## Free-tier notes
* Render Free sleeps after 15 minutes idle; the first request after that takes ~30–60 s (the app shows a "waking up" banner). For a demo, open the site a minute before presenting. Optional: a free uptime monitor (e.g. UptimeRobot) pinging `/api/health` every 10 minutes keeps it awake.
* Atlas M0 is free forever with 512 MB storage.
