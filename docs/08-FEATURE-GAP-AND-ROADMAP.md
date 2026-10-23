# 08 — Feature Gap Analysis & Roadmap

_Updated after Phase 2. Phase 1 is partly done: its data foundation (types, statuses, assignee, accountable, priority, category) was built because Phase 2 needs it. Comments, attachments, notifications, email and password reset are parked on the `phase-1-wip` branch._

Comparison between **OpenProject** (the `openproject-dev` source, version 18.0 dev) and our **Project Management System (PMS) v1**. The inventory comes from scanning OpenProject's 31 feature modules, ~150 permissions, ~170 data models and ~45 API endpoint groups, grouped into user-facing features.

## 1. Where we stand

| | Count |
|---|---|
| Features inventoried | **100** |
| ✅ Done in PMS | **32** |
| 🟡 Partially done | **10** |
| ❌ Missing | **58** |
| **Coverage today** (partial counts as half) | **37%** |

**Where PMS is already ahead of OpenProject:** OpenProject schedules only with Finish-to-Start ("precedes/follows") links and has no critical path. PMS supports all four MS Project link types (FS/SS/FF/SF) and calculates the critical path and total slack, so for *scheduling* it is closer to MS Project than OpenProject is.

**Where it is far behind:** everything around the schedule: workflows, comments, notifications, views, time and cost, agile, collaboration, integrations and enterprise security.

## 2. Roadmap at a glance

Phases are ordered by **leverage**: each one lays a foundation that later phases reuse, so every phase unlocks more than the one before it. For example, Phase 1's comments, history and notifications are reused by meetings, reminders and sharing in Phase 6; Phase 2's query engine powers boards, calendars, reports, the team planner and portfolio lists.

| Phase | Theme | Progress | Coverage after phase | Rough effort* |
|---|---|---|---|---|
| Now | Current PMS | — | **37%** | — |
| 1 | Real team task management | 🟡 2/11 done | **46%** | 3-4 weeks |
| 2 | Views, filters & interactive planning | ✅ Complete | **46%** | done |
| 3 | Projects & portfolio | Planned | **58%** | 4-5 weeks |
| 4 | Time, cost & budgets | Planned | **64%** | 3-4 weeks |
| 5 | Resources & permissions | Planned | **73%** | 4-5 weeks |
| 6 | Agile & collaboration | Planned | **84%** | 6-8 weeks |
| 7 | Enterprise security & platform | Planned | **93%** | 5-7 weeks |
| 8 | Integrations & intelligence | Planned | **100%** | 6-10 weeks |

\* One developer working with an AI coding assistant, including tests. Treat as order of magnitude, not a commitment.

## 3. Phase details

### Phase 1 — Real team task management

Turns the planner into a tool a team works in every day: types, statuses, owners, comments, files, notifications. Coverage after this phase: **46%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Task types (Task, Bug, Feature, Epic, Phase...) | Work packages | ✅ Done | `type, types` |
| Statuses & role-based workflows | Work packages | 🟡 Partial — Statuses done; role-based workflows pending | `status, workflow` |
| Assignee, accountable, priority, category | Work packages | ✅ Done | `work_package belongs_to` |
| Comments & full change history (journal) | Work packages | ❌ Missing | `journal, journals` |
| @mentions | Work packages | ❌ Missing | `notification reason: mentioned` |
| File attachments | Work packages | ❌ Missing | `attachment` |
| Watchers | Work packages | ❌ Missing | `watcher` |
| In-app notifications | Collaboration | ❌ Missing | `notification` |
| Email notifications (SMTP) | Collaboration | ❌ Missing | `mail_notifications` |
| Activity stream | Collaboration | ❌ Missing | `activity` |
| Password reset & email verification | Security & admin | ❌ Missing | `user_password, token` |

### Phase 2 — Views, filters & interactive planning

One query engine powers table, board, calendar and search; the Gantt becomes drag-and-drop. Coverage after this phase: **46%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Manual scheduling mode per task | Scheduling & Gantt | ✅ Done | `schedule_manually` |
| Drag & resize bars on the Gantt | Scheduling & Gantt | ✅ Done | `frontend gantt` |
| Non-scheduling relations (relates, blocks, duplicates, includes, requires) | Scheduling & Gantt | ✅ Done | `relation.rb` |
| Graphical Gantt PDF export | Scheduling & Gantt | ✅ Done | `pdf_export (gantt)` |
| Bulk edit, copy, move between projects | Work packages | ✅ Done | `copy/move_work_packages` |
| Readable IDs (e.g. PROJ-123) | Work packages | ✅ Done | `semantic_identifier` |
| Task table view | Views & reporting | ✅ Done | `work_packages_table` |
| Saved views: filters, sorting, grouping, columns | Views & reporting | ✅ Done | `query, persisted_query` |
| Kanban boards (status, assignee, version, subproject) | Views & reporting | ✅ Done | `modules/boards` |
| Calendar view | Views & reporting | ✅ Done | `modules/calendar` |
| Global search | Views & reporting | ✅ Done | `search_project` |

### Phase 3 — Projects & portfolio

Subprojects, templates, custom fields and portfolio dashboards for management. Coverage after this phase: **58%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Baseline snapshot & slippage | Scheduling & Gantt | 🟡 Partial — OP compares against any past date | `timestamps / baseline compare` |
| Custom fields on tasks | Work packages | ❌ Missing | `work_package_custom_field` |
| Form configuration per type | Work packages | ❌ Missing | `form_configuration` |
| Dashboard | Views & reporting | 🟡 Partial — PMS: fixed dashboard; OP: configurable widgets | `my_page, overviews` |
| Charts & graph widgets | Views & reporting | ❌ Missing | `work_packages_graph` |
| Archive projects | Projects & portfolio | 🟡 Partial — PMS: status only | `archive_project` |
| Subprojects (project hierarchy) | Projects & portfolio | ❌ Missing | `add_subprojects` |
| Portfolios & programs | Projects & portfolio | ❌ Missing | `add_portfolios, add_programs` |
| Project templates & copy project | Projects & portfolio | ❌ Missing | `copy_projects` |
| Project custom attributes | Projects & portfolio | ❌ Missing | `project_custom_field` |
| Project phases & gates (lifecycle) | Projects & portfolio | ❌ Missing | `project_phases` |
| Project list with saved filters & export | Projects & portfolio | 🟡 Partial — PMS: search + status filter | `project_queries, export_projects` |
| Enable/disable modules per project | Projects & portfolio | ❌ Missing | `select_project_modules` |
| Favorites | Projects & portfolio | ❌ Missing | `favorite` |

### Phase 4 — Time, cost & budgets

Timesheets, rates, budgets and cost reports; progress measured by work. Coverage after this phase: **64%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Work, remaining work & progress modes (work/status based) | Scheduling & Gantt | ❌ Missing | `progress_tracking settings` |
| Native Excel (XLSX) export | Views & reporting | ❌ Missing | `modules/xls_export` |
| Time logging (timesheets, activities) | Time, cost & budgets | ❌ Missing | `costs: time_entry` |
| Hourly rates (default & per project) | Time, cost & budgets | ❌ Missing | `hourly_rate` |
| Cost types & cost entries | Time, cost & budgets | ❌ Missing | `cost_type, cost_entry` |
| Budgets (labor & material) | Time, cost & budgets | ❌ Missing | `modules/budgets` |
| Cost & time reports | Time, cost & budgets | ❌ Missing | `modules/reporting` |

### Phase 5 — Resources & permissions

Resource planner, team planner, groups and fully configurable roles. Coverage after this phase: **73%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Team planner | Views & reporting | ❌ Missing | `modules/team_planner` |
| Configurable roles (~150 permissions) | Team & permissions | ❌ Missing | `role, role_permission` |
| Global roles | Team & permissions | ❌ Missing | `global_role` |
| Groups | Team & permissions | ❌ Missing | `group` |
| Placeholder users | Team & permissions | ❌ Missing | `placeholder_user` |
| Invite users by email | Team & permissions | ❌ Missing | `invite_members_by_email` |
| Workload / over-allocation | Resources | 🟡 Partial — PMS: simple count | `resource_management` |
| Resource allocation planner | Resources | ❌ Missing | `resource_allocation, resource_planner` |
| Personal working hours & time off | Resources | ❌ Missing | `user_working_hours, user_non_working_time` |

### Phase 6 — Agile & collaboration

Sprints and backlogs, meetings, wiki, documents, reminders. Coverage after this phase: **84%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Rich-text editor with macros | Work packages | ❌ Missing | `editor (CKEditor)` |
| Emoji reactions & internal comments | Work packages | ❌ Missing | `emoji_reaction, internal comments` |
| Share a task with outside people | Work packages | ❌ Missing | `share_work_packages` |
| Versions / releases / roadmap | Agile | ❌ Missing | `version` |
| Backlogs & sprints | Agile | ❌ Missing | `modules/backlogs` |
| Burndown charts & sprint goals | Agile | ❌ Missing | `burndown, sprint_goal` |
| Reminders & date alerts | Collaboration | ❌ Missing | `reminder, date_alert_*` |
| Meetings: agendas, outcomes, recurring, invites | Collaboration | ❌ Missing | `modules/meeting` |
| Wiki | Collaboration | ❌ Missing | `modules/wikis` |
| Documents | Collaboration | ❌ Missing | `modules/documents` |
| News & forums | Collaboration | ❌ Missing | `news, forum` |

### Phase 7 — Enterprise security & platform

SSO/2FA/LDAP, public API, webhooks, audit trail, multi-language, live updates. Coverage after this phase: **93%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Live updates between teammates | Collaboration | 🟡 Partial — PMS: 15 s polling | `(polling / websockets)` |
| REST API | Integrations | 🟡 Partial — PMS: internal API, not public/documented | `lib/api/v3` |
| API tokens & OAuth apps | Integrations | ❌ Missing | `oauth_client, token` |
| Webhooks | Integrations | ❌ Missing | `modules/webhooks` |
| Two-factor authentication | Security & admin | ❌ Missing | `two_factor_authentication` |
| SSO: OpenID Connect & SAML | Security & admin | ❌ Missing | `openid_connect, auth_saml` |
| LDAP & SCIM user sync | Security & admin | ❌ Missing | `ldap_*, scim_client` |
| Audit trail | Security & admin | 🟡 Partial — PMS: createdBy/updatedBy only | `paper_trail_audit, journals` |
| Multi-language (i18n) | Security & admin | ❌ Missing | `config/locales (30+ languages)` |
| System settings (mail, attachments, dates, virus scan) | Security & admin | ❌ Missing | `admin/settings/*` |
| Backups & health checks | Security & admin | 🟡 Partial — PMS: health endpoint only | `backup, health_report` |

### Phase 8 — Integrations & intelligence

Git, file storage, iCal, imports, automations, AI, BIM. Coverage after this phase: **100%**.

| Feature | Area | Today | OpenProject source |
|---|---|---|---|
| Custom actions & automations | Work packages | ❌ Missing | `custom_actions, automations` |
| Import (CSV / MS Project XML / Jira) | Views & reporting | ❌ Missing | `import_work_packages` |
| GitHub / GitLab integration | Integrations | ❌ Missing | `github_integration, gitlab_integration` |
| File storages (Nextcloud, OneDrive, SharePoint) | Integrations | ❌ Missing | `modules/storages` |
| iCal calendar subscriptions | Integrations | ❌ Missing | `icalendar_settings` |
| AI assistant & MCP | Integrations | ❌ Missing | `modules/llm, ai, mcp_configuration` |
| BIM / BCF (construction models) | Integrations | ❌ Missing — relevant for real estate | `modules/bim` |

## 4. Full inventory

### Scheduling & Gantt

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Gantt chart with bars, zoom (day/week/month), today line | ✅ Done | — |  | `modules/gantt` |
| Task hierarchy, WBS numbers, summary roll-ups | ✅ Done | — |  | `work_package hierarchy` |
| Milestones | ✅ Done | — |  | `types: milestone` |
| Finish-to-Start links with lag | ✅ Done | — |  | `relation: precedes/follows` |
| SS / FF / SF link types | ✅ Done | — | **PMS ahead of OpenProject.** | `(not in OpenProject)` |
| Critical path & total slack | ✅ Done | — | **PMS ahead of OpenProject.** | `(not in OpenProject)` |
| Auto-scheduling across the whole plan | ✅ Done | — |  | `work_packages/schedule services` |
| Working days & holidays | ✅ Done | — | PMS: per project; OP: global | `non_working_day, week_day` |
| Baseline snapshot & slippage | 🟡 Partial | 3 | OP compares against any past date | `timestamps / baseline compare` |
| Manual scheduling mode per task | ✅ Done | 2 |  | `schedule_manually` |
| Drag & resize bars on the Gantt | ✅ Done | 2 |  | `frontend gantt` |
| Non-scheduling relations (relates, blocks, duplicates, includes, requires) | ✅ Done | 2 |  | `relation.rb` |
| Graphical Gantt PDF export | ✅ Done | 2 |  | `pdf_export (gantt)` |
| Work, remaining work & progress modes (work/status based) | ❌ Missing | 4 |  | `progress_tracking settings` |

### Work packages

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Task name, duration, dates, % complete, notes | ✅ Done | — |  | `work_package` |
| Task types (Task, Bug, Feature, Epic, Phase...) | ✅ Done | 1 |  | `type, types` |
| Statuses & role-based workflows | 🟡 Partial | 1 | Statuses done; role-based workflows pending | `status, workflow` |
| Assignee, accountable, priority, category | ✅ Done | 1 |  | `work_package belongs_to` |
| Comments & full change history (journal) | ❌ Missing | 1 |  | `journal, journals` |
| @mentions | ❌ Missing | 1 |  | `notification reason: mentioned` |
| File attachments | ❌ Missing | 1 |  | `attachment` |
| Watchers | ❌ Missing | 1 |  | `watcher` |
| Custom fields on tasks | ❌ Missing | 3 |  | `work_package_custom_field` |
| Rich-text editor with macros | ❌ Missing | 6 |  | `editor (CKEditor)` |
| Bulk edit, copy, move between projects | ✅ Done | 2 |  | `copy/move_work_packages` |
| Readable IDs (e.g. PROJ-123) | ✅ Done | 2 |  | `semantic_identifier` |
| Emoji reactions & internal comments | ❌ Missing | 6 |  | `emoji_reaction, internal comments` |
| Share a task with outside people | ❌ Missing | 6 |  | `share_work_packages` |
| Custom actions & automations | ❌ Missing | 8 |  | `custom_actions, automations` |
| Form configuration per type | ❌ Missing | 3 |  | `form_configuration` |

### Views & reporting

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Task table view | ✅ Done | 2 |  | `work_packages_table` |
| Saved views: filters, sorting, grouping, columns | ✅ Done | 2 |  | `query, persisted_query` |
| Kanban boards (status, assignee, version, subproject) | ✅ Done | 2 |  | `modules/boards` |
| Calendar view | ✅ Done | 2 |  | `modules/calendar` |
| Team planner | ❌ Missing | 5 |  | `modules/team_planner` |
| Global search | ✅ Done | 2 |  | `search_project` |
| Dashboard | 🟡 Partial | 3 | PMS: fixed dashboard; OP: configurable widgets | `my_page, overviews` |
| Charts & graph widgets | ❌ Missing | 3 |  | `work_packages_graph` |
| CSV export | ✅ Done | — |  | `exports/csv` |
| PDF report export | ✅ Done | — |  | `pdf_export` |
| Native Excel (XLSX) export | ❌ Missing | 4 |  | `modules/xls_export` |
| Import (CSV / MS Project XML / Jira) | ❌ Missing | 8 |  | `import_work_packages` |

### Projects & portfolio

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Create/edit/delete projects, status | ✅ Done | — |  | `project` |
| Archive projects | 🟡 Partial | 3 | PMS: status only | `archive_project` |
| Subprojects (project hierarchy) | ❌ Missing | 3 |  | `add_subprojects` |
| Portfolios & programs | ❌ Missing | 3 |  | `add_portfolios, add_programs` |
| Project templates & copy project | ❌ Missing | 3 |  | `copy_projects` |
| Project custom attributes | ❌ Missing | 3 |  | `project_custom_field` |
| Project phases & gates (lifecycle) | ❌ Missing | 3 |  | `project_phases` |
| Project list with saved filters & export | 🟡 Partial | 3 | PMS: search + status filter | `project_queries, export_projects` |
| Enable/disable modules per project | ❌ Missing | 3 |  | `select_project_modules` |
| Favorites | ❌ Missing | 3 |  | `favorite` |

### Team & permissions

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| User registration & sign-in | ✅ Done | — |  | `user` |
| Admin user management (role, deactivate) | ✅ Done | — |  | `manage_user` |
| Project members with roles | ✅ Done | — | PMS: 4 fixed roles | `member, member_role` |
| Configurable roles (~150 permissions) | ❌ Missing | 5 |  | `role, role_permission` |
| Global roles | ❌ Missing | 5 |  | `global_role` |
| Groups | ❌ Missing | 5 |  | `group` |
| Placeholder users | ❌ Missing | 5 |  | `placeholder_user` |
| Invite users by email | ❌ Missing | 5 |  | `invite_members_by_email` |

### Time, cost & budgets

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Time logging (timesheets, activities) | ❌ Missing | 4 |  | `costs: time_entry` |
| Hourly rates (default & per project) | ❌ Missing | 4 |  | `hourly_rate` |
| Cost types & cost entries | ❌ Missing | 4 |  | `cost_type, cost_entry` |
| Budgets (labor & material) | ❌ Missing | 4 |  | `modules/budgets` |
| Cost & time reports | ❌ Missing | 4 |  | `modules/reporting` |

### Resources

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Resource list & assignment to tasks | ✅ Done | — |  | `assigned_to` |
| Workload / over-allocation | 🟡 Partial | 5 | PMS: simple count | `resource_management` |
| Resource allocation planner | ❌ Missing | 5 |  | `resource_allocation, resource_planner` |
| Personal working hours & time off | ❌ Missing | 5 |  | `user_working_hours, user_non_working_time` |

### Agile

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Versions / releases / roadmap | ❌ Missing | 6 |  | `version` |
| Backlogs & sprints | ❌ Missing | 6 |  | `modules/backlogs` |
| Burndown charts & sprint goals | ❌ Missing | 6 |  | `burndown, sprint_goal` |

### Collaboration

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| In-app notifications | ❌ Missing | 1 |  | `notification` |
| Email notifications (SMTP) | ❌ Missing | 1 |  | `mail_notifications` |
| Reminders & date alerts | ❌ Missing | 6 |  | `reminder, date_alert_*` |
| Activity stream | ❌ Missing | 1 |  | `activity` |
| Meetings: agendas, outcomes, recurring, invites | ❌ Missing | 6 |  | `modules/meeting` |
| Wiki | ❌ Missing | 6 |  | `modules/wikis` |
| Documents | ❌ Missing | 6 |  | `modules/documents` |
| News & forums | ❌ Missing | 6 |  | `news, forum` |
| Live updates between teammates | 🟡 Partial | 7 | PMS: 15 s polling | `(polling / websockets)` |

### Integrations

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| REST API | 🟡 Partial | 7 | PMS: internal API, not public/documented | `lib/api/v3` |
| API tokens & OAuth apps | ❌ Missing | 7 |  | `oauth_client, token` |
| Webhooks | ❌ Missing | 7 |  | `modules/webhooks` |
| GitHub / GitLab integration | ❌ Missing | 8 |  | `github_integration, gitlab_integration` |
| File storages (Nextcloud, OneDrive, SharePoint) | ❌ Missing | 8 |  | `modules/storages` |
| iCal calendar subscriptions | ❌ Missing | 8 |  | `icalendar_settings` |
| AI assistant & MCP | ❌ Missing | 8 |  | `modules/llm, ai, mcp_configuration` |
| BIM / BCF (construction models) | ❌ Missing | 8 | relevant for real estate | `modules/bim` |

### Security & admin

| Feature | Status | Phase | Notes | OpenProject source |
|---|---|---|---|---|
| Email + password auth, JWT, rate limiting | ✅ Done | — |  | `authentication` |
| Password reset & email verification | ❌ Missing | 1 |  | `user_password, token` |
| Two-factor authentication | ❌ Missing | 7 |  | `two_factor_authentication` |
| SSO: OpenID Connect & SAML | ❌ Missing | 7 |  | `openid_connect, auth_saml` |
| LDAP & SCIM user sync | ❌ Missing | 7 |  | `ldap_*, scim_client` |
| Audit trail | 🟡 Partial | 7 | PMS: createdBy/updatedBy only | `paper_trail_audit, journals` |
| Branding (name, theme color) | ✅ Done | — |  | `custom_style` |
| Dark mode & mobile layout | ✅ Done | — |  | `primer theme` |
| Multi-language (i18n) | ❌ Missing | 7 |  | `config/locales (30+ languages)` |
| System settings (mail, attachments, dates, virus scan) | ❌ Missing | 7 |  | `admin/settings/*` |
| Backups & health checks | 🟡 Partial | 7 | PMS: health endpoint only | `backup, health_report` |

## 5. Recommendation

- **Phases 1–3** make PMS a credible in-house replacement for MS Project *and* for what most teams use OpenProject for day to day.
- **Phase 4** matters if the business wants hours and costs tracked against budgets.
- **Phases 5–8** are about scale and enterprise integration (for example SSO with Nexora, file storage, Git). Build individual items when there is a concrete need rather than all of them.
- **BIM/BCF** (Phase 8) is the one niche module worth evaluating for a real-estate business: it links tasks to 3D building models.

