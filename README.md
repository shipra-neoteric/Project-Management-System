# Project Management System

An in-house, MS Project–style planning tool for Neoteric Properties, built from scratch and styled as a Nexora module.

**Features:** Gantt chart with an MS Project–style task grid · auto-scheduling with FS/SS/FF/SF dependencies and lag · working calendar with holidays · summary tasks and outline (indent/outdent) · milestones · critical path · baselines and slippage · resources and workload · team sharing with Owner/Manager/Member/Viewer roles · dashboard · Excel and PDF export · light and dark mode · mobile-friendly.

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

Optional sample data (an office fit-out project with 18 tasks, resources and a baseline):

```bash
cd backend
npm run seed:demo -- http://localhost:4000/api you@company.com YourPassword123 "Your Name"
```

The same command works against the live API (`https://<your-api>.onrender.com/api`) to prepare a demo.

## Quality checks

```bash
cd backend  && npm run typecheck && npm test     # 20 tests: scheduler + API
cd frontend && npm run typecheck && npm run build
```
