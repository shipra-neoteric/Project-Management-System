# 05 — UI / UX Design

The PMS is a **Nexora module**. The authoritative rules are the Nexora standards (`Design-System.md`, `UI_STYLE_GUIDE.md`, `NEXORA_UI_UX_GUIDE.md`, `NEXORA_DESIGN_TOKENS.md`, `NEXORA_COMPONENT_LIBRARY.md`, `NEXORA_FRONTEND_STANDARDS.md`). Put copies of those files in `docs/nexora/` so they live with the code. This document records **how PMS applies them** and the few PMS-specific patterns (Gantt) that Nexora did not have.

## 1. Decisions where the Nexora files differ

| Topic | Decision | Reason |
|---|---|---|
| Framework | Next.js (App Router) instead of Vite + React Router | Requested stack; Vercel hosting |
| Shared UI package | Local `src/components/ui/*` mirroring the `@neoteric/nexora-ui` contract | Package not available outside Nexora; swap-in later |
| Page title | `text-xl sm:text-2xl font-medium` | `Design-System.md` is the declared single source of truth |
| Cards | `rounded-lg shadow` | Same |
| Confirmations / toasts | SweetAlert2 | Both guides agree |

## 2. Tokens (from Nexora)

* Font: **Inter**, `system-ui` fallback — loaded via `next/font/google`.
* Brand: `--theme-primary` (default `#f97316`), `--theme-primary-light`, `--theme-primary-dark`. Set from **Organisation settings** (Admin can change). Brand elements use `useTheme().themeColor`, never hard-coded orange.
* Neutrals: `bg-gray-50 / dark:bg-gray-900` app, `bg-white / dark:bg-gray-800` surfaces, `border-gray-200 / dark:border-gray-700`.
* Status colors (pill + text, never color alone):

| PMS status | Badge |
|---|---|
| Not started | Neutral gray |
| In progress | Blue |
| Completed | Green |
| Overdue | Red |
| Project: Active / On hold / Completed / Archived | Green / Amber / Blue / Gray |
| Role: Owner / Manager / Member / Viewer | Purple / Blue / Green / Gray |

* Focus ring `focus:ring-2 focus:ring-blue-500/50`; spinner `Loader2 animate-spin text-gray-400`; icons `lucide-react` only.

## 3. App shell

```
┌────────────┬──────────────────────────────────────────────────────────┐
│  Sidebar   │  Header: ☰  Breadcrumb             🌙  Avatar ▾          │
│  (w-64 /   ├──────────────────────────────────────────────────────────┤
│   w-20)    │  Page: h1 + subtitle ............... [secondary] [Primary]│
│            │  KPI cards (grid-cols-2 sm:grid-cols-4)                   │
│ WORKSPACE  │  Toolbar / filter pills / search                          │
│  Dashboard │  Table or Gantt card                                      │
│  Projects  │                                                          │
│ ADMIN      │                                                          │
│  Users     │                                                          │
│  Settings  │                                                          │
└────────────┴──────────────────────────────────────────────────────────┘
```
Sidebar collapses to icons on desktop (state saved in `localStorage`) and becomes a slide-in overlay below `lg`. Active item: `theme-text font-semibold` on a 10% brand tint.

## 4. Screens

| Route | Content |
|---|---|
| `/login`, `/register` | Centered card, org name + brand tile, Field components, primary button |
| `/dashboard` | 4 KPI cards · Portfolio table (name, status, finish, progress bar, role) · Upcoming milestones · Overdue tasks |
| `/projects` | KPI cards (All / Active / On hold / Completed, clickable filters) · search · table · **New project** drawer · edit drawer · delete via Swal |
| `/projects/[id]` | Breadcrumb · project header · sub-tabs **Gantt · Resources · Settings** (Nexora filter-pill pattern) |
| `/projects/[id]` (Gantt tab) | Toolbar · split Task grid + Timeline · Task drawer |
| `/projects/[id]/resources` | Resource table with workload columns · add/edit drawer |
| `/projects/[id]/settings` | Details form · Working calendar · Members table + add member · Baseline · Danger zone |
| `/projects/[id]/table` | View toolbar · configurable columns · sortable headers · grouping · selection + bulk bar |
| `/projects/[id]/board` | Kanban columns (status/type/priority/assignee/category), draggable cards (ID, type, priority, progress, due date, assignee) |
| `/projects/[id]/calendar` | Month grid, lane-packed task bars coloured by status, prev/next/today |
| `/work-settings` (Admin) | Task types & statuses: colour, default, milestone/closed flags, order |
| `/users` (Admin) | User table, role/active toggles |
| `/settings` (Admin) | Organisation name, brand color picker with live preview |

## 5. Gantt (PMS-specific pattern)

* **One card**, one scroll container. The grid is `sticky left-0` so it stays visible while the timeline scrolls horizontally; the header row is `sticky top-0`. Rows are exactly **36 px** in both panes.
* **Grid:** uppercase `text-xs` headers (`bg-gray-50 dark:bg-gray-900`), `text-sm` cells, row hover `bg-gray-50 dark:bg-gray-700/50`, selected row `bg-blue-50 dark:bg-blue-900/20`. Summary rows bold. Click a cell to edit inline (`Enter` save, `Esc` cancel). Read-only for viewers.
* **Timeline bars** (SVG):
  * Task: rounded rect, brand color at 35% with the completed portion in solid brand color.
  * Critical task (when toggled): red-500 instead of brand.
  * Summary: dark gray bar with downward end caps.
  * Milestone: rotated square (◆), label with date.
  * Baseline (when toggled): thin gray bar under the task bar.
  * Links: gray elbow arrows; critical links red.
  * Today: dashed red vertical line; weekends/holidays shaded `gray-50 / gray-900/40` in Day zoom.
* **Zoom:** Day 32 px/day · Week 12 px/day · Month 4 px/day (filter-pill control).
* **Mobile:** grid shows # + Task name only; other columns hidden below `md`.

## 6. Shared view toolbar (Phase 2)
Every task view starts with the same bar: **saved-view picker** (`ThemedSelect`) · Save / Save as / Delete · quick **filter by text or ID** · **View options** button with a theme-colour badge counting active filters · removable filter chips (blue pills). *View options* opens a drawer (Nexora: complex filters live in a drawer) with sections Filters, Group by, Sort by and Columns. Selected rows show the Nexora bulk-actions bar (`bg-blue-50`, compact selects, red Delete).

Status badges and type labels use the admin-configured hex colour at 12 % opacity with the label always visible (never colour alone).

## 7. Phase 1 & 3 screens
| Route / place | Content |
|---|---|
| Header | Notification **bell** (unread badge in theme colour, dropdown, "View all"), profile menu link |
| `/notifications` | Unread / All tabs, mark all read, click opens the task |
| `/profile` | Name, email status, email-notification toggle, change password |
| `/forgot-password`, `/reset-password`, `/verify-email` | Auth-card pages (same as login) |
| Task drawer | Tabs **Details · Activity · Files**, Watch toggle, *Additional fields* section, status list limited by workflow, optional fields hidden per type |
| `/projects` | Tree (portfolio → program → project) with roll-up progress, favorite stars, tabs All / Favorites / Templates / Archived, status & type filters, Columns drawer, Excel export, saved lists |
| `/projects/[id]/overview` | KPI row, About + attributes, Life cycle strip, charts, Sub-projects, Milestones, Recent activity |
| `/projects/[id]/activity` | Project activity timeline with filters |
| Project settings | + Project attributes, Life cycle & gates, Baselines, Modules, Copy / Use template |
| `/work-settings` (Admin) | Tabs: Task types (incl. form fields), Statuses, Workflow matrix, Custom fields, Project phases |
| Dashboard | **Customize** drawer: switch widgets on/off and reorder; saved per user |

**Charts** follow the dataviz rules: part-to-whole is one stacked bar with 2px gaps plus a legend that always lists name, count and share (never colour alone); magnitude is single-hue bars sorted by value with the number at the bar end; gates use icon + label (✓ passed, ✕ failed, ○ pending).

## 8. States checklist (every data surface)
Loading (`Loader2` gray), empty (icon `w-12 h-12 text-gray-300` + CTA if permitted), error (red alert banner), permission denied (redirect + Swal toast), saving (inline spinner on buttons; "Saving…" chip in Gantt toolbar), cold-start banner (Render waking up).
