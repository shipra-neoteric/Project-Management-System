# 04 — API Reference

Base URL: `https://<render-service>.onrender.com/api` (local: `http://localhost:4000/api`)
Auth: `Authorization: Bearer <token>` on everything except register/login/health.
Content type: JSON. Errors: `{ "error": { "message": string, "code": string, "details"?: any, "requestId": string } }`.

| Code | Meaning |
|---|---|
| 400 `VALIDATION_ERROR` | Body failed Zod validation (`details` = field issues) |
| 400 `SCHEDULE_ERROR` | Change would create a circular dependency or invalid link |
| 401 `UNAUTHENTICATED` | Missing/invalid/expired token |
| 403 `FORBIDDEN` | Authenticated but lacking the required role |
| 404 `NOT_FOUND` | Unknown id or no access |
| 409 `CONFLICT` | e.g. email already registered |
| 429 `RATE_LIMITED` | Too many auth attempts |

## Health
`GET /api/health` → `{ ok: true, time }` (used by Render health check)

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password (min 8) }` | `{ token, user }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, user }` |
| GET | `/auth/me` | — | `{ user }` |

`user` = `{ _id, name, email, role, isActive }`

## Users
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/users` | any user | Directory for adding members: `[{ _id, name, email, role, isActive }]` |
| PATCH | `/users/:id` | Admin | `{ role?, isActive? }` — cannot demote/deactivate yourself |

## Organisation settings
| Method | Path | Who | Body |
|---|---|---|---|
| GET | `/settings` | any user | → `{ orgName, themeColor }` |
| PUT | `/settings` | Admin | `{ orgName?, themeColor? }` |

## Dashboard
`GET /dashboard` → `{ kpis: { projects, activeTasks, overdueTasks, percentComplete }, upcomingMilestones: Task[], overdueTasks: Task[] }` (each task includes `projectName`).

## Projects
| Method | Path | Min role | Body / notes |
|---|---|---|---|
| GET | `/projects` | — | Projects you own/are a member of (Admin: all). Includes `myRole` |
| POST | `/projects` | — | `{ name, description?, startDate, status? }` |
| GET | `/projects/:id` | viewer | Project with populated `owner` and `members.user`, plus `myRole` |
| PATCH | `/projects/:id` | manager | `{ name?, description?, status?, startDate?, workingDays?, holidays? }` — reschedules if calendar/start changed → `{ project, tasks }` |
| DELETE | `/projects/:id` | owner | Deletes project, tasks, resources |
| POST | `/projects/:id/baseline` | manager | Copies current start/finish into baseline fields → `{ project, tasks }` |
| DELETE | `/projects/:id/baseline` | manager | Clears baseline → `{ project, tasks }` |
| POST | `/projects/:id/members` | manager | `{ userId, role }` |
| PATCH | `/projects/:id/members/:userId` | manager | `{ role }` |
| DELETE | `/projects/:id/members/:userId` | manager | |

## Tasks
All mutations return the full recalculated plan: `{ project, tasks }` (tasks sorted by `rowNumber`).

| Method | Path | Min role | Body |
|---|---|---|---|
| GET | `/projects/:id/tasks` | viewer | → `{ project, tasks }` |
| POST | `/projects/:id/tasks` | member | `{ name, duration?, afterTaskId?, constraintStart? }` — inserted below `afterTaskId` (same parent), else at the end |
| PATCH | `/projects/:id/tasks/:taskId` | member | any of `{ name, duration, constraintStart, percentComplete, predecessors, resources, notes }` |
| DELETE | `/projects/:id/tasks/:taskId` | member | Deletes the task, its subtree, and links pointing at them |
| POST | `/projects/:id/tasks/:taskId/move` | member | `{ action: 'up' \| 'down' \| 'indent' \| 'outdent' }` |

`predecessors` = `[{ task: "<taskId>", type: "FS"|"SS"|"FF"|"SF", lag: number }]`.

## Resources
| Method | Path | Min role | Body |
|---|---|---|---|
| GET | `/projects/:id/resources` | viewer | |
| POST | `/projects/:id/resources` | member | `{ name, title?, email?, user? }` |
| PATCH | `/projects/:id/resources/:resourceId` | member | same fields, all optional |
| DELETE | `/projects/:id/resources/:resourceId` | member | Also unassigns from tasks |
