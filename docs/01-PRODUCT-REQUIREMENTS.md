# 01 — Product Requirements

**System name:** Project Management System (PMS)
**Owner:** Neoteric Properties
**Purpose:** An in-house, free-to-run replacement for Microsoft Project that lets teams plan, schedule and track shared projects with a Gantt chart, task dependencies and auto-scheduling. Visually it is a Nexora module (see `05-UI-UX-DESIGN.md`).

---

## 1. Users and roles

### 1.1 Application roles (global)

| Role | Who | Can do |
|---|---|---|
| **Admin** | IT / PMO lead. The **first account registered** becomes Admin automatically. | Everything, on every project. Manage users' roles and organisation settings (name, theme color). |
| **User** | Everyone else | Create projects. Access only projects they own or are a member of. |

### 1.2 Project roles (per project)

| Role | View plan | Edit tasks & resources | Edit project settings, members, baseline | Delete project |
|---|---|---|---|---|
| **Owner** (creator) | ✅ | ✅ | ✅ | ✅ |
| **Manager** | ✅ | ✅ | ✅ | ❌ |
| **Member** | ✅ | ✅ | ❌ | ❌ |
| **Viewer** | ✅ | ❌ | ❌ | ❌ |

Permissions are **enforced by the backend** on every request. The UI also hides controls the user cannot use (never just disables them).

---

## 2. Core workflows

### W1 — Sign up / sign in
Email + password. Session is a JWT (7 days). Logout clears it.

### W2 — Create a project
Name, description, start date, status (Active / On hold / Completed / Archived). The creator becomes Owner. Default calendar: Monday–Friday working, no holidays.

### W3 — Build the plan (the MS Project experience)
On the **Gantt** screen, a task grid on the left and a timeline on the right:

| Column | Behaviour |
|---|---|
| **#** | Row number (used to reference predecessors, like MS Project's ID) |
| **Task name** | Inline-editable. Summary tasks are bold with a collapse caret |
| **Duration** | Working days. `0` = milestone (◆) |
| **Start** | Computed. Typing a date sets a *Start No Earlier Than* constraint |
| **Finish** | Computed |
| **Predecessors** | Text like `3, 5SS+2, 7FF-1` (row + type + lag days) |
| **Resources** | Assigned people |
| **% Complete** | 0–100 |

Toolbar: Add task, Add milestone, Indent, Outdent, Move up/down, Delete, Zoom (Day/Week/Month), Show critical path, Show baseline, Set baseline, Export Excel, Export PDF.

Double-click a row (or the edit icon) to open the **Task drawer** with every field including notes and a predecessor editor.

### W4 — Auto-scheduling
Any change (duration, link, indent, constraint, calendar) recalculates the whole project on the server:
- Four dependency types: **FS** (Finish-to-Start), **SS**, **FF**, **SF**, each with lag (+/- working days).
- Weekends and project holidays are skipped.
- Summary tasks roll up start, finish, duration and % complete from their children.
- Circular dependencies are rejected with a clear error.
- **Critical path** (zero total slack) is computed and can be highlighted red.

### W5 — Resources
Per project resource list (name, job title, email). Assign resources to tasks. A workload view shows each person's assigned tasks, total work days and over-allocated days (two tasks on the same day).

### W6 — Share with the team
Owner/Manager adds registered users as Manager / Member / Viewer. Team members see changes within ~15 seconds (auto refresh) or immediately on refocus.

### W7 — Track progress
Set % complete. Status is derived: **Not started** (0%), **In progress**, **Completed** (100%), **Overdue** (finish < today and not complete).
**Baseline:** a snapshot of current start/finish for every task. The Gantt can draw baseline bars under the live bars to show slippage.

### W8 — Dashboard
KPI cards (Projects, Active tasks, Overdue tasks, Overall completion), a project portfolio table with progress bars, upcoming milestones (next 30 days) and overdue tasks across all your projects.

### W9 — Export
Excel-compatible CSV of the task list, and a PDF report (corporate navy header, per Nexora PDF rules).

---

## 3. Out of scope for v1 (possible later phases)
Cost/budget tracking, timesheets, file attachments, comments/chat, email notifications, MS Project (.mpp/.xml) import, hour-level scheduling, resource leveling, SSO with Nexora, real-time websockets.

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Cost | Runs entirely on free tiers: Vercel Hobby, Render Free, MongoDB Atlas M0 |
| Security | bcrypt password hashing, JWT auth, server-side authorization, rate-limited auth endpoints, Helmet headers, CORS restricted to the frontend URL, no secrets in git |
| Performance | Projects up to ~1,000 tasks schedule in < 100 ms |
| Responsiveness | Works from 360px to 1440px+; Gantt scrolls horizontally on small screens |
| Theme | Light and dark mode on every screen |
| Data | Dates stored as ISO-8601 `YYYY-MM-DD` strings (day precision) |
| Concurrency | Last write wins per change; every change returns the full recalculated plan |
