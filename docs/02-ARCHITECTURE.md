# 02 — Architecture

## 1. Overview

```
 Browser (team member)
      │  HTTPS
      ▼
┌──────────────────────────┐        REST/JSON + Bearer JWT        ┌──────────────────────────┐
│  FRONTEND — Vercel       │ ───────────────────────────────────▶ │  BACKEND — Render        │
│  Next.js 16 (App Router) │                                      │  Node.js 24 + Express 5  │
│  React 19 + TypeScript   │ ◀─────────────────────────────────── │  TypeScript              │
│  Tailwind CSS 4          │        full recalculated plan        │  Scheduling engine       │
│  TanStack Query          │                                      │  Mongoose 9              │
└──────────────────────────┘                                      └────────────┬─────────────┘
                                                                               │ mongodb+srv
                                                                               ▼
                                                                  ┌──────────────────────────┐
                                                                  │  MongoDB Atlas (M0 free) │
                                                                  └──────────────────────────┘
```

* One GitHub repository, two deployable folders: `frontend/` (Vercel "Root Directory") and `backend/` (Render "Root Directory").
* The **backend is the source of truth for the schedule.** The client sends an intent ("set duration of task X to 5"); the server applies it, re-runs the scheduler for the whole project, saves the computed dates, and returns every task. This keeps every team member's view consistent.

## 2. Repository layout

```
project-management-system/
├── README.md
├── docs/                         ← these design documents
├── backend/
│   ├── src/
│   │   ├── index.ts              ← boot: env → Mongo → listen
│   │   ├── app.ts                ← Express app, middleware, routes
│   │   ├── config/env.ts         ← validated environment variables
│   │   ├── models/               ← User, Project, Task, Resource, Setting
│   │   ├── middleware/           ← auth, project access, errors, request id
│   │   ├── routes/               ← auth, users, settings, projects, tasks, resources, dashboard
│   │   ├── scheduling/           ← calendar.ts, scheduler.ts (pure, unit-tested)
│   │   ├── services/             ← planService (load → mutate → schedule → persist)
│   │   └── utils/                ← HttpError, zod validation helper
│   └── tests/                    ← Vitest: scheduler unit tests, API smoke test
└── frontend/
    └── src/
        ├── app/                  ← Next.js routes (login, register, (app)/…)
        ├── components/
        │   ├── ui/               ← Nexora-equivalent primitives (Button, Field, Drawer, …)
        │   ├── layout/           ← AppShell, Sidebar, Header
        │   └── gantt/            ← TaskGrid, GanttChart, TaskDrawer, Toolbar
        ├── features/             ← projects, resources, members, users (drawers, tables)
        ├── lib/                  ← api client, auth, theme, dates, export, cn
        └── types/                ← shared TypeScript types
```

## 3. Backend request pipeline

`helmet → cors(FRONTEND_URL) → json(1mb) → requestId → routes → notFound → errorHandler`

* **Auth:** `requireAuth` verifies `Authorization: Bearer <jwt>` and loads the user.
* **Project access:** `loadProject(minRole)` resolves the caller's effective role on the project (Admin → owner-equivalent) and rejects with 403 if below `minRole`. Role ranks: viewer 1 < member 2 < manager 3 < owner 4.
* **Validation:** every body is parsed with Zod; failures return 400 with field details.
* **Errors:** a single envelope — `{ "error": { "message", "code", "details?", "requestId" } }`.
* **Request IDs:** every response has an `X-Request-Id` header (correlation ID, Nexora standard).

## 4. Plan mutation flow (tasks)

```
PATCH /api/projects/:id/tasks/:taskId   { duration: 5 }
   │
   ├─ loadProject('member')                          ← authorization
   ├─ planService.mutate(project, tasks => …)        ← load all tasks as plain objects
   │     ├─ apply change in memory
   │     ├─ scheduler.schedule(project, tasks)       ← throws on cycle / invalid link
   │     ├─ write diff: insertMany / deleteMany / bulkWrite updates
   │     └─ update project.finishDate + project.stats
   └─ 200 { project, tasks }                         ← client replaces its cache
```

Nothing is written if scheduling fails, so the plan is never left in a broken state.

## 5. Frontend architecture

* **Rendering:** client components behind a login gate (the API is on another domain, so the JWT lives in `localStorage` and is sent as a Bearer header — this avoids third-party cookie problems between `*.vercel.app` and `*.onrender.com`).
* **Server state:** TanStack Query. Query keys: `['projects']`, `['project', id]`, `['tasks', id]`, `['resources', id]`, `['users']`, `['dashboard']`, `['settings']`. The Gantt query refetches every 15 s and on window focus so teammates' edits appear.
* **Mutations:** each task mutation's response (`{project, tasks}`) is written straight into the query cache with `setQueryData` — no extra round trip.
* **Forms:** React Hook Form + Zod in drawers.
* **Theme:** `ThemeProvider` sets `dark` class on `<html>` before first paint and the `--theme-primary` CSS variables from organisation settings.

## 6. Free-tier constraints and how we handle them

| Constraint | Impact | Mitigation |
|---|---|---|
| Render Free sleeps after 15 min idle | First request takes ~30–60 s | API client timeout 70 s; UI shows "Waking up the server…" banner after 5 s |
| Atlas M0: 512 MB storage | Plenty for tens of thousands of tasks | Lean documents, indexes on `project` |
| Vercel Hobby | Non-commercial use | Upgrade to Pro later if required by policy |
