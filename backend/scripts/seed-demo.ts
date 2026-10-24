/**
 * Creates a complete demo through the public API (works locally or against the live Render API) so every
 * feature has data to look at: a portfolio → program → projects hierarchy, Gantt plans with links,
 * a baseline comparison, statuses, types, priorities, categories, custom fields, comments, mentions,
 * files, watchers, saved views, life-cycle gates, a template, a demo team with project roles, groups,
 * a custom role, a global role, a placeholder and a pending invitation, working hours and time off,
 * hourly rates, logged time, material costs, budgets and reports. Remove it with `npm run seed:cleanup`.
 *
 *   npm run seed:demo -- <apiUrl> <adminEmail> <adminPassword> [name]
 *
 * Run it as an administrator. Demo team members can sign in with DEMO_PASSWORD (see demo-names.ts).
 */
import {
  DEMO_COST_TYPES,
  DEMO_GLOBAL_ROLE,
  DEMO_INVITEE,
  DEMO_PASSWORD,
  DEMO_PLACEHOLDER,
  DEMO_PROJECT_NAMES,
  DEMO_PROJECTS,
  DEMO_ROLE,
  DEMO_TEAM,
  type DemoKey,
} from './demo-names';

type Task = { _id: string; name: string; start: string; finish: string; isSummary: boolean; isMilestone: boolean };
type Plan = { tasks: Task[]; createdTaskId?: string };
type Named = { _id: string; name: string };

const [apiUrl = 'http://localhost:4000/api', email = 'admin@example.com', password = 'Password123', adminName = 'Demo Admin'] = process.argv.slice(2);
const API = apiUrl.replace(/\/$/, '');
let token = '';

async function call<T>(path: string, method = 'GET', body?: unknown, as = token): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${data?.error?.message}`), { status: res.status });
  return data as T;
}

const isConflict = (err: unknown) => (err as { status?: number }).status === 409;

/** Creates something org-wide, or reuses it when it already exists (409). */
async function createOrReuse<T>(create: () => Promise<T>, find: () => Promise<T | undefined>): Promise<T> {
  try {
    return await create();
  } catch (err) {
    if (!isConflict(err)) throw err;
    const found = await find();
    if (!found) throw err;
    return found;
  }
}

async function upload(path: string, filename: string, type: string, content: string) {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), filename);
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`Upload ${filename} → ${res.status}`);
}

// ---- Dates ------------------------------------------------------------------------------------

const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const addDays = (date: string, n: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** Monday `weeks` weeks before this week's Monday (negative = in the future). */
function monday(weeks: number) {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - weeks * 7);
  return iso(d);
}
/** Working days (Mon–Fri) from `start` to `end`, both included. */
function workdays(start: string, end: string) {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) if (weekday(d) >= 1 && weekday(d) <= 5) out.push(d);
  return out;
}
const step = (label: string) => console.log(`• ${label}`);

// ---- Plan building ----------------------------------------------------------------------------

interface Row {
  name: string;
  /** 0 = summary (phase) row, 1 = task under the summary above */
  level: 0 | 1;
  duration?: number;
  after?: string[];
  pct?: number;
  status?: string;
  who?: DemoKey | 'me';
  accountable?: DemoKey | 'me';
  type?: string;
  priority?: 'low' | 'normal' | 'high' | 'immediate';
  category?: string;
  resources?: string[];
  /** Estimated work in hours (defaults to duration × 8 for leaf tasks). */
  work?: number;
  contractor?: string;
  area?: number;
}

async function main() {
  // ---- Admin sign-in -------------------------------------------------------------------------
  try {
    token = (await call<{ token: string }>('/auth/login', 'POST', { email, password })).token;
  } catch {
    try {
      token = (await call<{ token: string }>('/auth/register', 'POST', { name: adminName, email, password })).token;
      console.log(`Registered a new account for ${email}`);
    } catch {
      throw new Error(`Could not sign in as ${email}. Check the email and password (the account already exists).`);
    }
  }
  const me = (await call<{ user: { _id: string; name: string; role: string } }>('/auth/me')).user;
  if (me.role !== 'Admin') throw new Error(`${email} is not an administrator. Run the demo seed with an admin account.`);
  const existing = (await call<{ projects: Named[] }>('/projects')).projects.filter((p) => DEMO_PROJECT_NAMES.includes(p.name));
  if (existing.length) {
    throw new Error(`Demo projects already exist (${existing.map((p) => p.name).join(', ')}). Run "npm run seed:cleanup -- <apiUrl> <email> <password> --yes" first.`);
  }

  // ---- Demo team -----------------------------------------------------------------------------
  step('Demo team');
  const people: Record<string, { id: string; token: string; name: string }> = { me: { id: me._id, token, name: me.name } };
  for (const member of DEMO_TEAM) {
    let auth: { token: string; user: { _id: string } };
    try {
      auth = await call('/auth/register', 'POST', { name: member.name, email: member.email, password: DEMO_PASSWORD }, '');
    } catch (err) {
      if (!isConflict(err)) throw err;
      auth = await call('/auth/login', 'POST', { email: member.email, password: DEMO_PASSWORD }, '');
    }
    people[member.key] = { id: auth.user._id, token: auth.token, name: member.name };
  }
  const id = (k: DemoKey | 'me') => people[k].id;
  const mention = (k: DemoKey | 'me') => `@[${people[k].name}](${people[k].id})`;

  // ---- Organisation: roles, groups, placeholders, schedules, rates ---------------------------
  step('Roles, groups, placeholder, working hours, time off, hourly rates');
  const role = await createOrReuse(
    async () => (await call<{ role: Named }>('/roles', 'POST', { name: DEMO_ROLE, permissions: ['edit_tasks', 'comment', 'log_time', 'view_time', 'log_costs', 'view_budgets'] })).role,
    async () => (await call<{ roles: Named[] }>('/roles')).roles.find((r) => r.name === DEMO_ROLE),
  );
  const siteSupervisorRole = role._id;

  const globalRoles = (await call<{ roles: Named[] }>('/global-roles')).roles;
  const pmo =
    globalRoles.find((r) => r.name === DEMO_GLOBAL_ROLE) ??
    (await call<{ role: Named }>('/global-roles', 'POST', { name: DEMO_GLOBAL_ROLE, permissions: ['view_all_projects', 'manage_rates'], isDefault: false })).role;
  await call(`/users/${id('meera')}`, 'PATCH', { globalRoles: [pmo._id] });

  const group = async (name: string, description: string, members: string[]) =>
    createOrReuse(
      async () => (await call<{ group: Named }>('/groups', 'POST', { name, description, members })).group,
      async () => (await call<{ groups: Named[] }>('/groups')).groups.find((g) => g.name === name),
    );
  const designTeam = await group('Design team', 'Architects and interior designers', [id('priya'), id('neha')]);
  await group('Site engineers', 'Engineers and supervisors working on site', [id('rahul'), id('arjun')]);

  const users = (await call<{ users: (Named & { kind?: string })[] }>('/users')).users;
  const placeholder =
    users.find((u) => u.name === DEMO_PLACEHOLDER && u.kind === 'placeholder') ??
    (await call<{ user: Named }>('/users/placeholders', 'POST', { name: DEMO_PLACEHOLDER })).user;

  // Neha works part-time (6 h, Mon–Thu); some people have leave coming up or just taken.
  await call(`/users/${id('neha')}`, 'PATCH', { workSchedule: { hoursPerDay: 6, workingDays: [1, 2, 3, 4] } });
  await call('/time-off', 'POST', { user: id('rahul'), start: addDays(monday(-1), 3), end: addDays(monday(-1), 4), note: 'Family function' });
  await call('/time-off', 'POST', { user: id('anita'), start: monday(-2), end: addDays(monday(-2), 2), note: 'Annual leave' });
  await call('/time-off', 'POST', { user: id('priya'), start: addDays(monday(1), 2), end: addDays(monday(1), 2), note: 'Sick leave' });

  const rates: Record<string, number> = { me: 2000, priya: 1800, rahul: 1200, anita: 1600, vikram: 1100, neha: 1400, meera: 1500, arjun: 900 };
  for (const [k, rate] of Object.entries(rates)) await call('/rates', 'POST', { user: people[k].id, rate, validFrom: addDays(TODAY, -365) });

  // ---- Work settings: custom fields, cost types, workflow -----------------------------------
  step('Custom fields, cost types and workflow rules');
  type Field = Named & { options: Named[] };
  type WS = { types: Named[]; statuses: Named[]; phases: Named[]; activities: Named[]; costTypes: Named[]; customFields: Field[]; workflow: Record<string, unknown> };
  const ignoreConflict = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  };
  const field = (body: Record<string, unknown>) => ignoreConflict(() => call('/work-settings/custom-fields', 'POST', body));
  await field({ name: 'Contractor', scope: 'task', kind: 'select', options: ['In-house', 'ABC Interiors', 'Voltline Electricals', 'CoolAir HVAC'].map((n) => ({ name: n })), description: 'Who carries out the work' });
  await field({ name: 'Site area (m²)', scope: 'task', kind: 'number', description: 'Floor area covered by the task' });
  await field({ name: 'Cost centre', scope: 'project', kind: 'text', description: 'Finance cost centre code' });
  await field({ name: 'Region', scope: 'project', kind: 'select', options: ['North', 'South', 'West', 'East'].map((n) => ({ name: n })) });

  const costTypeSpecs = [
    { name: 'Gypsum board', unit: 'sheet', unitRate: 450, color: '#64748b' },
    { name: 'Paint', unit: 'litre', unitRate: 320, color: '#0ea5e9' },
    { name: 'Electrical cable', unit: 'metre', unitRate: 85, color: '#f59e0b' },
    { name: 'Vitrified tiles', unit: 'm²', unitRate: 1100, color: '#a855f7' },
    { name: 'Chiller unit', unit: 'unit', unitRate: 650000, color: '#14b8a6' },
  ];
  for (const spec of costTypeSpecs.filter((c) => DEMO_COST_TYPES.includes(c.name))) await ignoreConflict(() => call('/work-settings/cost-types', 'POST', spec));

  const ws = await call<WS>('/work-settings');
  const byName = (list: Named[], n: string) => list.find((x) => x.name === n)?._id ?? null;
  const status = (n: string) => byName(ws.statuses, n);
  const type = (n: string) => byName(ws.types, n);
  const activity = (n: string) => byName(ws.activities, n);
  const costType = (n: string) => byName(ws.costTypes, n)!;
  const cf = (n: string) => ws.customFields.find((f) => f.name === n)!;
  const option = (fieldName: string, n: string) => cf(fieldName).options.find((o) => o.name === n)?._id;

  // Site supervisors may move tasks forward and back but not close them (a manager closes after review).
  const [New, Prog, Hold, Review] = ['New', 'In progress', 'On hold', 'In review'].map((n) => status(n)!);
  await call('/work-settings/workflow', 'PUT', { ...(ws.workflow ?? {}), [siteSupervisorRole]: { [New]: [Prog], [Prog]: [Review, Hold], [Hold]: [Prog], [Review]: [Prog] } });

  // ---- Portfolio → program ---------------------------------------------------------------------
  step('Portfolio and program');
  const start = monday(4); // the main project started four weeks ago, so there is history and some overdue work
  const create = async (body: Record<string, unknown>) => (await call<{ project: Named }>('/projects', 'POST', body)).project;
  const portfolio = await create({ name: DEMO_PROJECTS.portfolio, description: 'Every real-estate initiative across our offices for FY 2026-27.', startDate: monday(8), kind: 'portfolio' });
  const program = await create({
    name: DEMO_PROJECTS.program,
    description: 'Office fit-outs and refurbishments in the head office campus.',
    startDate: monday(8),
    kind: 'program',
    parent: portfolio._id,
  });

  /** Creates the tasks of a project from rows and returns name → task. */
  async function buildPlan(projectId: string, rows: Row[], resourceIds: Record<string, string> = {}, categories: Record<string, string> = {}) {
    const base = `/projects/${projectId}`;
    const ids: Record<string, string> = {};
    for (const r of rows) {
      const body = r.level === 0 ? { name: r.name, duration: 1, ...(type('Phase') ? { type: type('Phase') } : {}) } : { name: r.name, duration: r.duration ?? 1 };
      ids[r.name] = (await call<Plan>(`${base}/tasks`, 'POST', body)).createdTaskId!;
    }
    if (rows.some((x) => x.level === 0)) for (const r of rows) if (r.level === 1) await call(`${base}/tasks/${ids[r.name]}/move`, 'POST', { action: 'indent' });
    let plan: Plan = { tasks: [] };
    for (const r of rows) {
      if (r.level === 0) continue;
      const leaf = (r.duration ?? 1) > 0;
      const work = r.work ?? (leaf ? (r.duration ?? 1) * 8 : null);
      const pct = r.pct ?? 0;
      const customValues: Record<string, unknown> = {};
      if (r.contractor) customValues[cf('Contractor')._id] = option('Contractor', r.contractor);
      if (r.area) customValues[cf('Site area (m²)')._id] = r.area;
      plan = await call<Plan>(`${base}/tasks/${ids[r.name]}`, 'PATCH', {
        predecessors: (r.after ?? []).map((p) => ({ task: ids[p], type: 'FS', lag: 0 })),
        percentComplete: pct,
        status: status(r.status ?? (pct >= 100 ? 'Closed' : pct > 0 ? 'In progress' : 'New')),
        ...(r.who ? { assignee: id(r.who) } : {}),
        ...(r.accountable ? { accountable: id(r.accountable) } : {}),
        ...(r.type ? { type: type(r.type) } : {}),
        ...(r.priority ? { priority: r.priority } : {}),
        ...(r.category && categories[r.category] ? { category: categories[r.category] } : {}),
        ...(r.resources ? { resources: r.resources.map((x) => resourceIds[x]) } : {}),
        ...(work !== null ? { work, remainingWork: Math.round(work * (1 - pct / 100)) } : {}),
        ...(Object.keys(customValues).length ? { customValues } : {}),
      });
    }
    const byTask = new Map(plan.tasks.map((t) => [t._id, t]));
    return { ids, task: (n: string) => byTask.get(ids[n])! };
  }

  /** Logs time for each started task: the assignee's hours on past working days, roughly matching % done. */
  async function logHistory(projectId: string, rows: Row[], tasks: (n: string) => Task, activityFor: (r: Row) => string) {
    let count = 0;
    for (const r of rows) {
      if (r.level === 0 || !r.who || !r.pct || (r.duration ?? 1) === 0) continue;
      const t = tasks(r.name);
      const last = t.finish < TODAY ? t.finish : addDays(TODAY, -1);
      const days = workdays(t.start, last).slice(-10);
      if (!days.length) continue;
      const target = ((r.work ?? (r.duration ?? 1) * 8) * r.pct) / 100;
      const perDay = Math.max(1, Math.min(8, Math.round((target / days.length) * 2) / 2));
      for (const [i, date] of days.entries()) {
        const hours = Math.max(0.5, perDay - (i % 3 === 2 ? 1.5 : 0));
        await call('/time-entries', 'POST', {
          project: projectId,
          task: t._id,
          user: id(r.who),
          activity: activityFor(r),
          date,
          hours,
          comment: i === 0 ? 'Started work' : i === days.length - 1 ? 'Progress update' : '',
        });
        count++;
      }
    }
    return count;
  }

  // ---- Main project: Corporate Office Fit-out --------------------------------------------------
  step(`${DEMO_PROJECTS.fitOut}: team, plan, statuses, links`);
  const fitOut = await create({
    name: DEMO_PROJECTS.fitOut,
    description: 'Interior fit-out of the 4th floor: design, approvals, civil works, MEP, furniture and handover.',
    startDate: start,
    parent: program._id,
  });
  const base = `/projects/${fitOut._id}`;
  const member = (body: Record<string, unknown>) => call(`${base}/members`, 'POST', body);
  await member({ userId: id('priya'), role: 'manager' });
  for (const k of ['rahul', 'anita', 'vikram'] as const) await member({ userId: id(k), role: 'member' });
  await member({ userId: id('arjun'), role: siteSupervisorRole });
  await member({ userId: id('meera'), role: 'viewer' });
  await member({ groupId: designTeam._id, role: 'member' }); // Neha gets access through the Design team group
  await member({ userId: placeholder._id, role: 'member' });
  await call('/users/invite', 'POST', { email: DEMO_INVITEE.email, name: DEMO_INVITEE.name, projectId: fitOut._id, role: 'viewer' });

  const resourceIds: Record<string, string> = {};
  for (const [n, title] of [['Carpentry crew', 'Subcontractor'], ['Electricians', 'Subcontractor'], ['Scissor lift', 'Equipment'], ['Painters', 'Subcontractor']]) {
    resourceIds[n] = (await call<{ resource: Named }>(`${base}/resources`, 'POST', { name: n, title })).resource._id;
  }
  const cats = (await call<{ project: { categories: Named[] } }>(base, 'PATCH', { categories: ['Design', 'Civil', 'MEP', 'Interiors'].map((name) => ({ name })) })).project.categories;
  const catIds = Object.fromEntries(cats.map((c) => [c.name, c._id]));

  const fitRows: Row[] = [
    { name: 'Design & Approvals', level: 0 },
    { name: 'Site survey', level: 1, duration: 2, pct: 100, who: 'priya', category: 'Design', area: 1200 },
    { name: 'Concept design', level: 1, duration: 5, after: ['Site survey'], pct: 100, who: 'priya', accountable: 'me', category: 'Design', contractor: 'In-house' },
    { name: 'Client approval', level: 1, duration: 0, after: ['Concept design'], pct: 100, accountable: 'me' },
    { name: 'Detailed drawings', level: 1, duration: 6, after: ['Client approval'], pct: 90, status: 'In review', who: 'neha', accountable: 'priya', priority: 'high', category: 'Design', contractor: 'In-house' },
    { name: 'Civil Works', level: 0 },
    { name: 'Demolition', level: 1, duration: 3, after: ['Client approval'], pct: 100, who: 'rahul', priority: 'high', category: 'Civil', resources: ['Carpentry crew'], contractor: 'ABC Interiors', area: 1200 },
    { name: 'Partitions & ceilings', level: 1, duration: 8, after: ['Demolition', 'Detailed drawings'], pct: 40, who: 'rahul', accountable: 'priya', category: 'Civil', resources: ['Carpentry crew', 'Scissor lift'], contractor: 'ABC Interiors', area: 950 },
    { name: 'Flooring', level: 1, duration: 5, after: ['Partitions & ceilings'], who: 'arjun', category: 'Civil', contractor: 'ABC Interiors', area: 1200 },
    { name: 'Painting', level: 1, duration: 4, after: ['Partitions & ceilings'], who: 'arjun', category: 'Interiors', resources: ['Painters'], contractor: 'ABC Interiors' },
    { name: 'MEP', level: 0 },
    { name: 'Electrical wiring', level: 1, duration: 6, after: ['Demolition'], pct: 70, who: 'anita', category: 'MEP', resources: ['Electricians'], contractor: 'Voltline Electricals' },
    { name: 'HVAC ducting', level: 1, duration: 7, after: ['Demolition'], pct: 60, status: 'On hold', who: 'anita', priority: 'high', category: 'MEP', contractor: 'CoolAir HVAC' },
    { name: 'Risk: long lead time for chillers', level: 1, duration: 10, after: ['Client approval'], pct: 30, type: 'Risk', who: 'vikram', accountable: 'me', priority: 'immediate', category: 'MEP' },
    { name: 'Fire safety systems', level: 1, duration: 4, after: ['HVAC ducting'], who: 'anita', priority: 'high', category: 'MEP', contractor: 'Voltline Electricals' },
    { name: 'Furniture & Handover', level: 0 },
    { name: 'Order furniture', level: 1, duration: 3, after: ['Client approval'], pct: 100, who: 'vikram', category: 'Interiors' },
    { name: 'Furniture installation', level: 1, duration: 4, after: ['Flooring', 'Painting', 'Order furniture'], who: 'vikram', category: 'Interiors', resources: ['Carpentry crew'] },
    { name: 'Snag: cracked floor tile at entrance', level: 1, duration: 1, after: ['Flooring'], type: 'Bug', who: 'arjun', priority: 'normal', category: 'Civil' },
    { name: 'Snagging & cleaning', level: 1, duration: 3, after: ['Furniture installation', 'Fire safety systems'], who: 'me', category: 'Interiors' },
    { name: 'Handover to client', level: 1, duration: 0, after: ['Snagging & cleaning'], accountable: 'me' },
  ];
  const fit = await buildPlan(fitOut._id, fitRows, resourceIds, catIds);
  const tid = (n: string) => fit.ids[n];
  await call(`${base}/tasks/${tid('Fire safety systems')}`, 'PATCH', { relations: [{ task: tid('Electrical wiring'), type: 'relates' }] });
  await call(`${base}/tasks/${tid('Risk: long lead time for chillers')}`, 'PATCH', { relations: [{ task: tid('HVAC ducting'), type: 'blocks' }] });

  step('Baselines, life cycle, custom values, favourites');
  await call(`${base}/baselines`, 'POST', { name: 'Approved plan' });
  // After the baseline, design took longer: the slip shows up in the baseline comparison.
  await call(`${base}/tasks/${tid('Detailed drawings')}`, 'PATCH', { duration: 8 });
  await call(`${base}/baselines`, 'POST', { name: 'Re-plan after design changes' });
  await call(`${base}/tasks/${tid('HVAC ducting')}`, 'PATCH', { duration: 9 });
  await call(base, 'PATCH', {
    lifecycle: ws.phases.slice(0, 4).map((p, i) => ({
      definition: p._id,
      start: addDays(start, i * 14),
      finish: addDays(start, i * 14 + 13),
      gateStatus: i === 0 ? 'passed' : i === 1 ? 'failed' : 'pending',
    })),
    customValues: { [cf('Cost centre')._id]: 'CC-4410 Head office', [cf('Region')._id]: option('Region', 'West') },
  });
  for (const p of [fitOut, program]) await call(`/projects/${p._id}/favorite`, 'POST');

  step('Comments, mentions, watchers and files');
  const comment = (taskName: string, who: DemoKey | 'me', text: string) => call(`${base}/tasks/${tid(taskName)}/comments`, 'POST', { text }, people[who].token);
  await comment('Detailed drawings', 'priya', `Client asked for an extra meeting room on level 4, so the drawings need two more days. ${mention('me')} please note the change.`);
  await comment('Detailed drawings', 'neha', `Revised layout uploaded. ${mention('priya')} can you review the ceiling plan?`);
  await comment('Detailed drawings', 'me', `Thanks both. ${mention('neha')} let's close this by Friday.`);
  await comment('HVAC ducting', 'anita', `On hold until the chiller order is confirmed. ${mention('vikram')} any update from the supplier?`);
  await comment('HVAC ducting', 'vikram', `Supplier promises dispatch in 3 weeks. ${mention('me')} we may need to approve air freight.`);
  await comment('Partitions & ceilings', 'rahul', 'Gypsum boards delivered (first lot). Framing on the east wing is complete.');
  await comment('Snag: cracked floor tile at entrance', 'arjun', 'Photo attached. Tile to be replaced before handover.');
  await call(`${base}/tasks/${tid('HVAC ducting')}/watch`, 'POST');
  await call(`${base}/tasks/${tid('Risk: long lead time for chillers')}/watch`, 'POST', undefined, people.meera.token);
  const files = `${base}/tasks`;
  await upload(`${files}/${tid('Detailed drawings')}/attachments`, 'Level-4-layout-rev-B.txt', 'text/plain', 'Level 4 layout, revision B\n- Extra meeting room added near the east core\n- Pantry moved to the north side\n');
  await upload(`${files}/${tid('Concept design')}/attachments`, 'Concept-options.csv', 'text/csv', 'Option,Seats,Meeting rooms,Cost (INR lakh)\nA,120,6,145\nB,132,5,152\n');
  await upload(
    `${files}/${tid('Snag: cracked floor tile at entrance')}/attachments`,
    'snag-entrance.svg',
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#e5e7eb"/><path d="M40 30 L120 80 L90 120" stroke="#ef4444" stroke-width="4" fill="none"/><text x="12" y="20" font-size="12" font-family="sans-serif">Entrance tile – crack</text></svg>',
  );

  step('Saved views and project lists');
  const view = (name: string, kind: string, isPublic: boolean, config: Record<string, unknown>) =>
    call(`${base}/views`, 'POST', { name, kind, isPublic, config: { filters: [], search: '', sort: [], groupBy: null, columns: [], options: {}, ...config } });
  const cols = ['id', 'name', 'type', 'status', 'assignee', 'start', 'finish', 'percentComplete'];
  const contractorCol = `cf:${cf('Contractor')._id}`;
  await view('My open tasks', 'table', false, { filters: [{ field: 'assignee', op: 'in', value: [me._id] }, { field: 'percentComplete', op: 'lte', value: 99 }], columns: cols });
  await view('Overdue work', 'table', true, { filters: [{ field: 'overdue', op: 'is', value: true }], sort: [{ field: 'finish', dir: 'asc' }], columns: [...cols, 'priority'] });
  await view('Time vs estimate', 'table', true, { filters: [{ field: 'summary', op: 'is', value: false }], sort: [{ field: 'spentHours', dir: 'desc' }], columns: ['id', 'name', 'assignee', 'work', 'remainingWork', 'spentHours', 'percentComplete'] });
  await view('By contractor', 'table', true, { groupBy: contractorCol, columns: ['id', 'name', contractorCol, `cf:${cf('Site area (m²)')._id}`, 'status', 'finish'] });
  await view('Critical path', 'gantt', true, { filters: [{ field: 'critical', op: 'is', value: true }] });
  await view('Board by assignee', 'board', true, { groupBy: 'assignee' });
  await view('MEP board', 'board', true, { filters: [{ field: 'category', op: 'in', value: [catIds.MEP] }] });
  await view('Milestones', 'calendar', true, { filters: [{ field: 'milestone', op: 'is', value: true }] });
  const projectList = (name: string, filters: unknown[]) =>
    call('/project-views', 'POST', { name, isPublic: true, config: { filters, search: '', sort: [], groupBy: null, columns: ['status', 'start', 'finish', 'progress', 'tasks', 'owner'], options: {} } });
  await projectList('Active projects', [{ field: 'status', op: 'in', value: ['active'] }]);
  await projectList('Programs & portfolios', [{ field: 'kind', op: 'in', value: ['program', 'portfolio'] }]);

  step('Time, rates, costs and budgets');
  await call(`${base}/rates`, 'POST', { user: id('priya'), rate: 2200, validFrom: start }); // specialist rate on this project
  const actFor = (r: Row) => activity(r.category === 'Design' ? 'Design' : r.who === 'vikram' ? 'Procurement' : 'Site work');
  let entries = await logHistory(fitOut._id, fitRows, fit.task, (r) => actFor(r)!);
  for (const [i, date] of workdays(start, addDays(TODAY, -1)).filter((d) => weekday(d) === 1).entries()) {
    for (const k of ['me', 'priya', 'rahul', 'anita'] as const) {
      await call('/time-entries', 'POST', { project: fitOut._id, user: id(k), activity: activity('Meetings'), date, hours: 1, comment: `Weekly site meeting #${i + 1}` });
      entries++;
    }
  }
  const civil = (
    await call<{ budget: Named }>(`${base}/budgets`, 'POST', {
      name: 'Civil & interiors',
      description: 'Partitions, ceilings, flooring, painting and furniture installation.',
      labor: [
        { label: 'Site engineer', user: id('rahul'), hours: 160, rate: 1200 },
        { label: 'Site supervisor', user: id('arjun'), hours: 120, rate: 900 },
        { label: 'Carpentry crew', hours: 200, rate: 650 },
      ],
      material: [
        { costType: costType('Gypsum board'), units: 180, comment: '12 mm boards' },
        { costType: costType('Paint'), units: 240 },
        { costType: costType('Vitrified tiles'), units: 450, comment: '600×600 mm' },
      ],
    })
  ).budget;
  const mep = (
    await call<{ budget: Named }>(`${base}/budgets`, 'POST', {
      name: 'MEP services',
      description: 'Electrical, HVAC and fire safety.',
      labor: [{ label: 'MEP consultant', user: id('anita'), hours: 100, rate: 1600 }],
      material: [
        { costType: costType('Electrical cable'), units: 1200 },
        { costType: costType('Chiller unit'), units: 1, comment: '60 TR air-cooled' },
      ],
    })
  ).budget;
  for (const n of ['Demolition', 'Partitions & ceilings', 'Flooring', 'Painting', 'Furniture installation']) await call(`${base}/tasks/${tid(n)}`, 'PATCH', { budget: civil._id });
  for (const n of ['Electrical wiring', 'HVAC ducting', 'Fire safety systems']) await call(`${base}/tasks/${tid(n)}`, 'PATCH', { budget: mep._id });
  const cost = (costTypeName: string, units: number, daysAgo: number, taskName: string, note: string, who: DemoKey | 'me' = 'me') =>
    call(`${base}/cost-entries`, 'POST', { costType: costType(costTypeName), units, date: addDays(TODAY, -daysAgo), task: tid(taskName), comment: note }, people[who].token);
  await cost('Gypsum board', 80, 12, 'Partitions & ceilings', 'First delivery', 'rahul');
  await cost('Gypsum board', 60, 5, 'Partitions & ceilings', 'Second delivery', 'rahul');
  await cost('Electrical cable', 650, 14, 'Electrical wiring', 'FR cable, 2.5 sq mm', 'anita');
  await cost('Electrical cable', 300, 6, 'Electrical wiring', 'FR cable, 4 sq mm', 'anita');
  await cost('Chiller unit', 1, 3, 'HVAC ducting', 'Advance order (50% paid)', 'me');
  await cost('Paint', 40, 2, 'Painting', 'Primer for east wing', 'arjun');

  // ---- Reception & Lobby: work-based progress -------------------------------------------------
  step(`${DEMO_PROJECTS.lobby}: work-based progress`);
  const lobby = await create({
    name: DEMO_PROJECTS.lobby,
    description: 'Refresh of the ground-floor reception: new desk, flooring, lighting and signage.',
    startDate: monday(2),
    parent: program._id,
  });
  const lobbyBase = `/projects/${lobby._id}`;
  await call(`${lobbyBase}/members`, 'POST', { userId: id('neha'), role: 'manager' });
  for (const k of ['vikram', 'rahul'] as const) await call(`${lobbyBase}/members`, 'POST', { userId: id(k), role: 'member' });
  await call(`${lobbyBase}/members`, 'POST', { userId: id('meera'), role: 'viewer' });
  await call(lobbyBase, 'PATCH', { progressMode: 'work', customValues: { [cf('Cost centre')._id]: 'CC-4410 Head office', [cf('Region')._id]: option('Region', 'West') } });
  const lobbyRows: Row[] = [
    { name: 'Design brief', level: 1, duration: 3, pct: 100, who: 'me', work: 16 },
    { name: 'Furniture & finishes selection', level: 1, duration: 5, after: ['Design brief'], pct: 60, who: 'neha', work: 30 },
    { name: 'Strip-out', level: 1, duration: 2, after: ['Design brief'], pct: 100, who: 'rahul', work: 16 },
    { name: 'Flooring & lighting', level: 1, duration: 6, after: ['Strip-out', 'Furniture & finishes selection'], who: 'rahul', work: 48 },
    { name: 'Reception desk installation', level: 1, duration: 3, after: ['Flooring & lighting'], who: 'vikram', work: 24 },
    { name: 'Signage & handover', level: 1, duration: 0, after: ['Reception desk installation'], accountable: 'me' },
  ];
  const lob = await buildPlan(lobby._id, lobbyRows);
  entries += await logHistory(lobby._id, lobbyRows, lob.task, (r) => activity(r.who === 'neha' || r.who === 'me' ? 'Design' : 'Site work')!);
  await call(`${lobbyBase}/budgets`, 'POST', {
    name: 'Lobby refresh',
    labor: [{ label: 'Interior designer', user: id('neha'), hours: 40, rate: 1400 }],
    material: [{ costType: costType('Vitrified tiles'), units: 160 }],
  });
  await call(`${lobbyBase}/cost-entries`, 'POST', { costType: costType('Vitrified tiles'), units: 60, date: addDays(TODAY, -2), task: lob.ids['Flooring & lighting'], comment: 'Italian finish, lot 1' });

  // ---- Data Centre: on hold, status-based progress, overlaps Rahul's other work ---------------
  step(`${DEMO_PROJECTS.dataCentre}: on hold, status-based progress`);
  const dc = await create({
    name: DEMO_PROJECTS.dataCentre,
    description: 'Replace two CRAC units and add hot-aisle containment in the server room.',
    startDate: monday(1),
    parent: program._id,
  });
  const dcBase = `/projects/${dc._id}`;
  await call(`${dcBase}/members`, 'POST', { userId: id('anita'), role: 'manager' });
  for (const k of ['rahul', 'arjun'] as const) await call(`${dcBase}/members`, 'POST', { userId: id(k), role: 'member' });
  await call(`${dcBase}/members`, 'POST', { userId: placeholder._id, role: 'member' });
  await call(dcBase, 'PATCH', { progressMode: 'status' });
  const dcRows: Row[] = [
    { name: 'Heat load study', level: 1, duration: 3, status: 'Closed', who: 'anita' },
    { name: 'Vendor evaluation', level: 1, duration: 5, after: ['Heat load study'], status: 'In review', who: 'anita' },
    { name: 'Containment installation', level: 1, duration: 6, after: ['Vendor evaluation'], status: 'In progress', who: 'rahul' },
    { name: 'CRAC unit replacement', level: 1, duration: 4, after: ['Vendor evaluation'], status: 'New', who: 'arjun' },
    { name: 'Commissioning & testing', level: 1, duration: 2, after: ['Containment installation', 'CRAC unit replacement'], status: 'New', who: 'anita' },
  ];
  await buildPlan(dc._id, dcRows);
  await call(`${dcBase}/rates`, 'POST', { user: id('anita'), rate: 2000, validFrom: monday(1) });
  await call(dcBase, 'PATCH', { status: 'on_hold', customValues: { [cf('Cost centre')._id]: 'CC-5120 IT infrastructure', [cf('Region')._id]: option('Region', 'North') } });

  // ---- Archived, completed project ------------------------------------------------------------
  step(`${DEMO_PROJECTS.archived}: completed and archived`);
  const ev = await create({ name: DEMO_PROJECTS.archived, description: 'Twelve EV charging bays in the basement car park (completed last year).', startDate: monday(30), parent: portfolio._id });
  await call(`/projects/${ev._id}/members`, 'POST', { userId: id('anita'), role: 'manager' });
  await call(`/projects/${ev._id}/members`, 'POST', { userId: id('rahul'), role: 'member' });
  await buildPlan(ev._id, [
    { name: 'Load assessment', level: 1, duration: 4, pct: 100, who: 'anita' },
    { name: 'Cabling & charger installation', level: 1, duration: 10, after: ['Load assessment'], pct: 100, who: 'rahul' },
    { name: 'Commissioning', level: 1, duration: 2, after: ['Cabling & charger installation'], pct: 100, who: 'anita' },
  ]);
  await call(`/projects/${ev._id}`, 'PATCH', { status: 'archived', customValues: { [cf('Region')._id]: option('Region', 'South') } });

  // ---- Template ------------------------------------------------------------------------------
  step('Project template');
  await call(`${base}/copy`, 'POST', {
    name: DEMO_PROJECTS.template,
    startDate: monday(-4),
    isTemplate: true,
    copy: { tasks: true, resources: true, members: false, views: true },
  });

  console.log(`\nDone. ${entries} time entries logged across ${DEMO_PROJECT_NAMES.length} projects.`);
  console.log(`Sign in as ${email}, or as any demo team member (e.g. ${DEMO_TEAM[0].email}) with password ${DEMO_PASSWORD}, to see their role.`);
  console.log('Remove all demo data later with: npm run seed:cleanup -- <apiUrl> <email> <password> --yes');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
