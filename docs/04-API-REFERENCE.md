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
| PATCH | `/projects/:id` | manager | `{ name?, key?, description?, status?, startDate?, workingDays?, holidays?, categories?: [{ _id?, name }] }` — reschedules if calendar/start changed → `{ project, tasks }` |
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
| POST | `/projects/:id/tasks/bulk` | member | `{ taskIds, patch: { status?, type?, priority?, assignee?, accountable?, category?, percentComplete? } }` |
| POST | `/projects/:id/tasks/bulk-delete` | member | `{ taskIds }` (sub-tasks included) |
| POST | `/projects/:id/tasks/transfer` | member (both projects) | `{ taskIds, targetProjectId, mode: 'copy' \| 'move' }` — copies keep links inside the selection; returns the source plan |

Task create/update also accept `type`, `status`, `priority`, `assignee`, `accountable`, `category`; update accepts `manual` and `relations: [{ task, type }]`.

`predecessors` = `[{ task: "<taskId>", type: "FS"|"SS"|"FF"|"SF", lag: number }]`.

## Saved views
| Method | Path | Min role | Body |
|---|---|---|---|
| GET | `/projects/:id/views` | viewer | Public views + your private ones |
| POST | `/projects/:id/views` | viewer (`isPublic: true` needs manager) | `{ name, kind, isPublic, config }` |
| PATCH | `/projects/:id/views/:viewId` | creator or manager | any of the above |
| DELETE | `/projects/:id/views/:viewId` | creator or manager | |

## Types, statuses, priorities
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/work-settings` | any user | `{ types, statuses, priorities }` |
| POST / PATCH / DELETE | `/work-settings/types[/:id]` | Admin | `{ name, color, position?, isDefault?, isMilestone? }`; delete refused if in use |
| POST / PATCH / DELETE | `/work-settings/statuses[/:id]` | Admin | `{ name, color, position?, isDefault?, isClosed? }`; delete refused if in use |

## Search
`GET /search?q=…` (min 2 chars) → `{ projects: [...], tasks: [{ ..., projectName, projectKey }] }` across accessible projects. Matches names, notes, project keys and IDs like `OF-12`.

## Resources
| Method | Path | Min role | Body |
|---|---|---|---|
| GET | `/projects/:id/resources` | viewer | |
| POST | `/projects/:id/resources` | member | `{ name, title?, email?, user? }` |
| PATCH | `/projects/:id/resources/:resourceId` | member | same fields, all optional |
| DELETE | `/projects/:id/resources/:resourceId` | member | Also unassigns from tasks |
