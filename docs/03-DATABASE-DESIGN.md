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

## Relationships

```
users 1───* projects (owner)
users *───* projects (members[])
projects 1───* tasks ──┐ parent (self-reference, tree)
                       └ predecessors[] (self-reference, graph)
projects 1───* resources *───* tasks (resources[])
```

Deleting a project deletes its tasks and resources.
