# 03 — Database Design (MongoDB Atlas)

Database name: `pms` (taken from the connection string). All collections have `createdAt` / `updatedAt` (Mongoose timestamps). Dates without time are stored as ISO strings `YYYY-MM-DD`.

## users

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `name` | string | required, 2–80 chars |
| `email` | string | required, unique, lowercase |
| `passwordHash` | string | bcrypt (cost 10); never returned by the API |
| `role` | `'Admin' \| 'User'` | first registered user = Admin |
| `isActive` | boolean | inactive users cannot sign in |

Indexes: `{ email: 1 }` unique.

## settings (single document, `key: 'org'`)

| Field | Type | Notes |
|---|---|---|
| `key` | string | always `'org'` |
| `orgName` | string | shown in the sidebar, default "Neoteric Properties" |
| `themeColor` | string | hex, default `#f97316` — drives `--theme-primary` |

## projects

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `name` | string | required |
| `key` | string | unique, 2–10 uppercase letters/digits; prefix of task IDs (e.g. `OF`) — generated from the name, editable |
| `taskSeq` | number | last task number issued in this project |
| `categories` | `[{ _id, name }]` | project task categories; removing one clears it from tasks |
| `description` | string | optional |
| `status` | `'active' \| 'on_hold' \| 'completed' \| 'archived'` | default `active` |
| `startDate` | string `YYYY-MM-DD` | project start; nothing is scheduled earlier |
| `finishDate` | string | **computed** = latest task finish |
| `workingDays` | number[] | 0=Sun … 6=Sat, default `[1,2,3,4,5]` |
| `holidays` | string[] | `YYYY-MM-DD` non-working dates |
| `owner` | ObjectId → users | creator |
| `members` | `[{ user: ObjectId, role: 'manager' \| 'member' \| 'viewer' }]` | |
| `baselineSavedAt` | Date \| null | when the baseline was last set |
| `stats` | `{ taskCount, completedCount, overdueCount, percentComplete }` | **computed** on every plan change, used by dashboard/list |
| `createdBy`, `updatedBy` | ObjectId | audit |

Indexes: `{ owner: 1 }`, `{ 'members.user': 1 }`.

## tasks

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `project` | ObjectId → projects | required |
| `parent` | ObjectId → tasks \| null | outline hierarchy |
| `order` | number | position among siblings (0-based) |
| `name` | string | required |
| `duration` | number | working days; `0` = milestone. For summaries it is the computed span |
| `constraintStart` | string \| null | *Start No Earlier Than* date |
| `percentComplete` | number 0–100 | summaries: duration-weighted roll-up |
| `predecessors` | `[{ task: ObjectId, type: 'FS'\|'SS'\|'FF'\|'SF', lag: number }]` | links into this task |
| `resources` | ObjectId[] → resources | assignments |
| `notes` | string | |
| `type` | ObjectId → tasktypes | |
| `status` | ObjectId → statuses | closing statuses set `percentComplete` to 100 |
| `priority` | `'low' \| 'normal' \| 'high' \| 'immediate'` | default `normal` |
| `assignee`, `accountable` | ObjectId → users \| null | must be the project owner or a member |
| `category` | ObjectId (project category) \| null | |
| `number` | number | readable ID `KEY-number`, assigned once, never reused |
| `manual` | boolean | manually scheduled: starts exactly on `constraintStart`, ignoring links |
| `relations` | `[{ task: ObjectId, type: 'relates'\|'blocks'\|'duplicates'\|'includes'\|'requires' }]` | non-scheduling links (stored on one side) |
| `watchers` | ObjectId[] | reserved for Phase 1 notifications |
| `baselineStart`, `baselineFinish` | string \| null | snapshot from "Set baseline" |
| **computed by scheduler** | | |
| `start`, `finish` | string | inclusive working dates |
| `isSummary` | boolean | has children |
| `isMilestone` | boolean | leaf with duration 0 |
| `isCritical` | boolean | total slack ≤ 0 |
| `totalSlack` | number | working days |
| `wbs` | string | outline number `1.2.3` |
| `outlineLevel` | number | 0 = top level |
| `rowNumber` | number | 1-based position in the flattened plan (the "#" column) |
| `createdBy`, `updatedBy` | ObjectId | audit |

Indexes: `{ project: 1, rowNumber: 1 }`.

## resources

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `project` | ObjectId → projects | resources are per project |
| `name` | string | required |
| `title` | string | job title, optional |
| `email` | string | optional |
| `user` | ObjectId → users \| null | optional link to an app user |

Deleting a resource removes it from every task's `resources` array.

## tasktypes / statuses (organisation-wide)

| Field | Type | Notes |
|---|---|---|
| `name` | string | unique (case-insensitive) |
| `color` | hex string | used for labels, badges, board columns, calendar bars |
| `position` | number | display order |
| `isDefault` | boolean | exactly one default (new tasks) |
| `isMilestone` | boolean | *types only*: used for tasks created with duration 0 |
| `isClosed` | boolean | *statuses only*: counts as done |

Seeded automatically on first start; items in use by tasks cannot be deleted.

## views (saved views)

| Field | Type | Notes |
|---|---|---|
| `project` | ObjectId → projects | |
| `owner` | ObjectId → users | creator |
| `name` | string | |
| `kind` | `'gantt' \| 'table' \| 'board' \| 'calendar'` | |
| `isPublic` | boolean | shared with the whole project (managers only) |
| `config` | `{ filters[], search, sort[], groupBy, columns[], options }` | interpreted by the frontend query engine |

## Phase 1 & 3 collections

| Collection | Purpose | Key fields |
|---|---|---|
| `journals` | Task history and comments | `project`, `task`, `taskName`, `user`, `kind` (`created`/`change`/`comment`/`deleted`/`attachment`), `text`, `changes[{field,label,from,to}]` (display strings), `mentions[]`, `editedAt` |
| `notifications` | In-app notifications | `recipient`, `actor`, `project`, `projectName`, `task`, `taskName`, `journal`, `reason`, `summary`, `read` |
| `attachments` + GridFS bucket `attachments` | Task files | `project`, `task`, `fileId`, `filename`, `contentType`, `size`, `uploadedBy` |
| `customfields` | Admin-defined fields | `name`, `scope` (`task`/`project`), `kind`, `options[{_id,name}]`, `required`, `position`, `description` |
| `phasedefinitions` | Life-cycle phases | `name`, `color`, `gate`, `position` |
| `baselines` | Named plan snapshots | `project`, `name`, `createdBy`, `finishDate`, `tasks[{task,start,finish}]` |

New fields: **users** `emailVerified`, `notifyByEmail`, `favorites[]`, `dashboardWidgets[]`, hashed one-time `verifyTokenHash` / `resetTokenHash` (+ `resetTokenExpires`) · **projects** `kind`, `parent`, `isTemplate`, `disabledModules[]`, `lifecycle[{definition,start,finish,gateStatus}]`, `customValues` · **tasks** `watchers[]`, `customValues` · **tasktypes** `hiddenFields[]` · **settings** `workflow` (role → from status → allowed statuses) · **views** `project` may be null for saved project lists (`kind: 'projects'`).

## Relationships

```
users 1───* projects (owner)
users *───* projects (members[])
projects 1───* tasks ──┐ parent (self-reference, tree)
                       └ predecessors[] (self-reference, graph)
projects 1───* resources *───* tasks (resources[])
```

Deleting a project deletes its tasks and resources.
