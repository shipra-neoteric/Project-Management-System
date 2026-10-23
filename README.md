# Project Management System

An in-house, MS Project–style planning tool for Neoteric Properties, built from scratch and styled as a Nexora module.

**Features:** portfolios, programs & sub-projects with roll-ups · project overview with charts · templates & project copy · custom fields for tasks and projects · life-cycle phases & gates · comments with @mentions, task history, attachments, watchers · in-app & email notifications · status workflows · favorites, saved project lists, configurable dashboard · multiple baselines · password reset & email confirmation · Gantt, Table, Kanban board and Calendar views with filters, grouping and saved views · drag-and-drop scheduling · readable task IDs (OF-12) · types, statuses, priorities, assignees, categories · bulk edit, copy & move between projects · global search (Ctrl+K) · graphical Gantt PDF · Gantt chart with an MS Project–style task grid · auto-scheduling with FS/SS/FF/SF dependencies and lag · working calendar with holidays · summary tasks and outline (indent/outdent) · milestones · critical path · baselines and slippage · resources and workload · team sharing with Owner/Manager/Member/Viewer roles · dashboard · Excel and PDF export · light and dark mode · mobile-friendly.

| Part | Tech | Hosting (free tier) |
|---|---|---|
| `frontend/` | Next.js 16, React 19, TypeScript, Tailwind CSS 4, TanStack Query | Vercel |
| `backend/` | Node.js 24, Express 5, TypeScript, Mongoose 9, Zod, JWT | Render |
| Database | MongoDB | MongoDB Atlas M0 |

## Documentation

| Doc | |
|---|---|
| [01 – Product requirements](docs/01-PRODUCT-REQUIREMENTS.md) | Users, roles, workflows, scope |
| [02 – Architecture](docs/02-ARCHITECTURE.md) | System design and request flow |
| [03 – Database design](docs/03-DATABASE-DESIGN.md) | Collections and fields |
| [04 – API reference](docs/04-API-REFERENCE.md) | Every endpoint |
| [05 – UI/UX design](docs/05-UI-UX-DESIGN.md) | How Nexora standards are applied |
| [06 – Scheduling engine](docs/06-SCHEDULING-ENGINE.md) | How dates and the critical path are calculated |
| [07 – Deployment guide](docs/07-DEPLOYMENT-GUIDE.md) | Atlas → GitHub → Render → Vercel, step by step |
| [08 – Feature gap & roadmap](docs/08-FEATURE-GAP-AND-ROADMAP.md) | 100-feature comparison with OpenProject and phased plan |

## Run locally

Prerequisite: Node.js 24.

```bash
# 1. Backend (terminal 1)
cd backend
npm install
npm run dev:memory        # in-memory database, no setup needed (data resets on stop)
# …or with MongoDB Atlas: copy .env.example to .env, fill it in, then `npm run dev`

# 2. Frontend (terminal 2)
cd frontend
npm install
cp .env.example .env.local
npm run dev               # http://localhost:3000
```

Register an account (the first account becomes Admin).

## Demo data (local or live)

`seed:demo` creates a showcase through the API: the **Corporate Real Estate Program** containing **Corporate Office Fit-out** (18 tasks with links, statuses, categories, resources, a named baseline, life-cycle phases and a comment) and **Reception & Lobby Refurbishment** (6 tasks), plus the **Office Fit-out Template**. Everything is owned by the account you pass in.

```bash
cd backend
# Live site: register your admin account on the website first, then use its email/password here
npm run seed:demo -- https://<your-api>.onrender.com/api you@company.com YourPassword "Your Name"

# Remove it again — first a dry run that lists what would go, then the real delete
npm run seed:cleanup -- https://<your-api>.onrender.com/api you@company.com YourPassword
npm run seed:cleanup -- https://<your-api>.onrender.com/api you@company.com YourPassword --yes
```

The clean-up deletes only projects with the demo names that this account owns (with their tasks, files, comments and baselines); your real projects are untouched. Running the seed twice creates a second copy, and the clean-up removes both.

## Quality checks

```bash
cd backend  && npm run typecheck && npm test     # 41 tests: scheduler, API, Phases 1–3
cd frontend && npm run typecheck && npm run build
```
