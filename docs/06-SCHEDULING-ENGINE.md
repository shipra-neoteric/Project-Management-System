# 06 — Scheduling Engine

Source: `backend/src/scheduling/` (pure TypeScript, no database access, unit-tested in `backend/tests/scheduler.test.ts`).

## 1. Working-day model

The calendar maps every **working day** from the project start to an integer index (`0, 1, 2, …`), skipping non-working weekdays and holidays. All maths happens on these indices, so weekends never need special cases.

A task occupies the half-open interval **[start, end)** on that axis:

* `end = start + duration`
* Displayed **Start** = date of index `start`
* Displayed **Finish** = date of index `end − 1` (or `start` for milestones, duration 0)

## 2. Dependency rules (forward pass — earliest dates)

For a link *P → S* with lag *L* (working days, may be negative) and successor duration *d*:

| Type | Meaning | Constraint on S's earliest start |
|---|---|---|
| **FS** | S starts after P finishes | `S.start ≥ P.end + L` |
| **SS** | S starts after P starts | `S.start ≥ P.start + L` |
| **FF** | S finishes after P finishes | `S.start ≥ P.end + L − d` |
| **SF** | S finishes after P starts | `S.start ≥ P.start + L − d` |

Also: `S.start ≥ 0` (project start), `S.start ≥ constraintStart` (Start No Earlier Than), and `S.start ≥` the earliest start inherited from its summary parent.

Example: Task 1 (3 days, Mon–Wed) → FS → Task 2 (2 days) starts Thursday, finishes Friday. With lag +1 it starts next Monday (weekend skipped).

## 3. Summary tasks

A task with children is a summary:

* `start = min(children.start)`, `end = max(children.end)`, `duration = end − start`.
* `% complete` = duration-weighted average of leaf descendants.
* **Links out of a summary** use its rolled-up dates (all four types).
* **Links into a summary** (FS / SS only) push all of its children: each child inherits the summary's earliest start. FF/SF into a summary are rejected (`SCHEDULE_ERROR`) — link the child tasks instead.

Internally each summary is split into two graph nodes — an *in-gate* (start floor, before its children) and an *out-gate* (roll-up, after its children) — so the graph stays acyclic.

## 4. Order of evaluation

Kahn's topological sort over: `predecessor → successor` links, `summary-in → child`, `child → summary-out`. If any node cannot be ordered, the plan contains a **cycle** and the change is rejected with the names of the tasks involved.

## 5. Critical path (backward pass — latest dates)

`projectEnd = max(end)` of all tasks. Processing in reverse topological order, each task's latest end is the minimum of:

* `projectEnd`
* its summary parent's latest end
* for each outgoing link to *S*:

| Type | Latest end of P |
|---|---|
| FS | `S.lateStart − L` |
| SS | `S.lateStart − L + P.duration` |
| FF | `S.lateEnd − L` |
| SF | `S.lateEnd − L + P.duration` |

`lateStart = lateEnd − duration`, `totalSlack = lateStart − start`. A task with `totalSlack ≤ 0` is **critical**. A summary is critical if any child is critical.

## 6. Outputs written back to each task
`start, finish, duration (summaries), percentComplete (summaries), isSummary, isMilestone, isCritical, totalSlack, wbs, outlineLevel, rowNumber`.

## 7. Limits (v1)
Day granularity (no hours), one calendar per project, no resource leveling, constraints limited to Start No Earlier Than.
