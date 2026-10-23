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

### W10 — Classify and assign work (Phase 2 foundation)
Every task has a **type** (Task, Milestone, Phase, Feature, Bug, Risk — admin-configurable), a **status** (New, In progress, On hold, In review, Closed, Rejected — admin-configurable; closed statuses set the task to 100 %), a **priority** (Low, Normal, High, Immediate), an **assignee** and an **accountable** person (project members), and an optional project **category**. Each task gets a readable ID such as `OF-12` built from the project key.

### W11 — Views (Phase 2)
One shared query engine powers four views of the same plan, each with filters (any field, multiple conditions), quick text/ID search, and **saved views** (private, or shared with the project by managers):

| View | What it adds |
|---|---|
| **Gantt** | Filters keep matching tasks plus their summary tasks; drag a bar to move it, drag its end to change the duration; **manual scheduling** pins a task to its date; graphical **Gantt PDF** (A3) |
| **Table** | Choose columns, sort by header, group by status/type/priority/assignee/category, Excel export of the current view |
| **Board** | Kanban columns by status (or type, priority, assignee, category); drag cards between columns |
| **Calendar** | Month grid with task bars coloured by status; milestones as diamonds |

### W12 — Work in bulk (Phase 2)
Tick tasks in the Gantt or Table (Shift-click for a range) to set status/type/priority/assignee/category, **copy** them (within the project or to another project) or **move** them to another project — sub-tasks and links between the selected tasks come along — or delete them.

### W13 — Find anything (Phase 2)
Global search in the header (Ctrl/⌘+K) across every project you can access: project names/keys, task names, notes and IDs like `OF-12`. Picking a task opens its details directly.

### W14 — Related tasks (Phase 2)
Besides scheduling links, tasks can be related without affecting dates: *relates to*, *blocks / blocked by*, *duplicates*, *includes / part of*, *requires*.

### W15 — Collaborate on tasks (Phase 1)
- **History:** every create, change, delete, comment and file upload on a task is recorded with who, when and the old → new value.
- **Comments** with **@mentions** (type `@` to pick a project member). Authors can edit their comments; managers can delete any.
- **Attachments:** up to 10 MB per file, stored in MongoDB (GridFS). Files always download (never open inline) for safety.
- **Watchers:** creators, assignees and commenters watch a task automatically; anyone can Watch / Unwatch.
- **Notifications:** a bell with unread count and a notifications page. Reasons: mentioned, assigned, accountable, commented, updated. Also sent by **email** when SMTP is configured (each person can switch email off in their profile).
- **Activity stream:** a project-wide Activity tab (filter by comments, changes, files).

### W16 — Accounts (Phase 1)
Forgot-password email with a one-hour, single-use link · email confirmation after registration (banner until confirmed) · profile page (name, change password, email preference).

### W17 — Status workflow (Phase 1)
Admins decide, per project role (Manager / Member), which status changes are allowed (e.g. members may go New → In progress but not → Closed). Owners and admins are never restricted. Enforced on the server; the task form only offers allowed statuses.

### W18 — Portfolios, programs and sub-projects (Phase 3)
Each project is a **Project**, **Program** or **Portfolio** and can sit inside another. Programs and portfolios **roll up** progress, task counts, overdue counts and dates from everything beneath them. Every project has an **Overview** tab: key figures, description and attributes, life cycle, tasks-by-status / workload / tasks-by-type charts, sub-projects, upcoming milestones and recent activity.

### W19 — Templates and copies (Phase 3)
Tick **Use as a template** on any project; everyone can then start a new project from it. Copies bring the plan (tasks, links, custom values), resources, categories, shared views and optionally team members. Fixed dates move with the new start date.

### W20 — Custom fields and forms (Phase 3)
Admins add custom fields for **tasks** or **projects**: text, long text, number, date, list (single/multi), yes/no, person. They appear in the task drawer / project settings, and task fields work in every filter, column, sort and group-by. Each task **type** chooses which optional fields its form shows (e.g. hide Resources on Risks).

### W21 — Life cycle and gates (Phase 3)
Admins define phases (default: Initiating, Planning, Executing, Closing), each with an optional gate. Managers plan phase dates per project and record gate decisions (Pending / Passed / Failed), shown as a timeline on the Overview.

### W22 — More Phase 3 tools
**Favorites** (star projects; shown in the sidebar and dashboard) · **saved project lists** with columns, filters and Excel export · **modules** per project (hide Gantt/Table/Board/Calendar/Resources/Activity tabs) · **archiving** makes a project read-only until reactivated · **multiple named baselines**, any of which can be compared on the Gantt · **configurable dashboard** (choose and reorder widgets: key figures, my tasks, favorites, status and workload charts, portfolio, milestones, overdue).

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
