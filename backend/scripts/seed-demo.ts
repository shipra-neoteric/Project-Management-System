/**
 * Creates realistic demo data through the public API (works locally or against the live Render API):
 * a program with two projects (Gantt plan, statuses, categories, resources, baseline, life cycle,
 * comment) and a project template. Remove it again with `npm run seed:cleanup`.
 *
 *   npm run seed:demo -- <apiUrl> <email> <password> [name]
 *   npm run seed:demo -- https://your-api.onrender.com/api you@company.com YourPassword "Your Name"
 *
 * Signs in with the account (registers it only if the email is not taken yet), then builds the data.
 */
import { DEMO_PROJECTS } from './demo-names';

type Plan = { tasks: { _id: string; name: string }[]; createdTaskId?: string };

const [apiUrl = 'http://localhost:4000/api', email = 'admin@example.com', password = 'Password123', name = 'Demo Admin'] = process.argv.slice(2);
let token = '';

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.error?.message}`);
  return data as T;
}

function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 14 + ((8 - d.getUTCDay()) % 7)); // a Monday ~2 weeks ago, so progress looks real
  return d.toISOString().slice(0, 10);
}

async function main() {
  try {
    token = (await call<{ token: string }>('/auth/login', 'POST', { email, password })).token;
  } catch {
    // Only register when the email is free; a wrong password for an existing account stops here.
    try {
      token = (await call<{ token: string }>('/auth/register', 'POST', { name, email, password })).token;
      console.log(`Registered a new account for ${email}`);
    } catch {
      throw new Error(`Could not sign in as ${email}. Check the email and password (the account already exists).`);
    }
  }

  const { project } = await call<{ project: { _id: string } }>('/projects', 'POST', {
    name: DEMO_PROJECTS.fitOut,
    description: 'Interior fit-out of the 4th floor: design, approvals, civil works, MEP, furniture and handover.',
    startDate: nextMonday(),
  });
  const base = `/projects/${project._id}`;
  console.log(`Created project ${project._id}`);

  const people = ['Priya Sharma|Project Architect', 'Rahul Verma|Site Engineer', 'Anita Desai|MEP Consultant', 'Vikram Rao|Procurement Lead'];
  const res: Record<string, string> = {};
  for (const p of people) {
    const [n, title] = p.split('|');
    res[n.split(' ')[0]] = (await call<{ resource: { _id: string } }>(`${base}/resources`, 'POST', { name: n, title })).resource._id;
  }

  // [name, duration, level, predecessors (names), resources, % complete]
  const plan: [string, number, number, string[], string[], number][] = [
    ['Design & Approvals', 0, 0, [], [], 0],
    ['Site survey', 2, 1, [], ['Priya', 'Rahul'], 100],
    ['Concept design', 5, 1, ['Site survey'], ['Priya'], 100],
    ['Client approval', 0, 1, ['Concept design'], [], 100],
    ['Detailed drawings', 6, 1, ['Client approval'], ['Priya'], 60],
    ['Civil Works', 0, 0, [], [], 0],
    ['Demolition', 3, 1, ['Client approval'], ['Rahul'], 40],
    ['Partitions & ceilings', 8, 1, ['Demolition', 'Detailed drawings'], ['Rahul'], 0],
    ['Flooring', 5, 1, ['Partitions & ceilings'], ['Rahul'], 0],
    ['MEP', 0, 0, [], [], 0],
    ['Electrical wiring', 6, 1, ['Demolition'], ['Anita'], 10],
    ['HVAC ducting', 7, 1, ['Demolition'], ['Anita'], 0],
    ['Fire safety systems', 4, 1, ['HVAC ducting'], ['Anita'], 0],
    ['Furniture & Handover', 0, 0, [], [], 0],
    ['Order furniture', 3, 1, ['Client approval'], ['Vikram'], 0],
    ['Furniture installation', 4, 1, ['Flooring', 'Order furniture'], ['Vikram', 'Rahul'], 0],
    ['Snagging & cleaning', 3, 1, ['Furniture installation', 'Fire safety systems'], ['Rahul'], 0],
    ['Handover to client', 0, 1, ['Snagging & cleaning'], [], 0],
  ];

  const ws0 = await call<{ types: { _id: string; name: string }[] }>('/work-settings');
  const phaseType = ws0.types.find((t) => t.name === 'Phase')?._id;
  const ids: Record<string, string> = {};
  for (const [taskName, duration, level] of plan) {
    // Level-0 rows become summary "phases"; level-1 milestones have duration 0.
    const body = level === 0 ? { name: taskName, duration: 1, ...(phaseType ? { type: phaseType } : {}) } : { name: taskName, duration };
    const r = await call<Plan>(`${base}/tasks`, 'POST', body);
    ids[taskName] = r.createdTaskId!;
  }
  // Indent level-1 tasks under the summary above them.
  for (const [taskName, , level] of plan) if (level === 1) await call(`${base}/tasks/${ids[taskName]}/move`, 'POST', { action: 'indent' });
  // Order furniture runs in parallel with civil works: FS link with no lag; Furniture install also needs flooring.
  for (const [taskName, , , preds, resources, pct] of plan) {
    if (!preds.length && !resources.length && !pct) continue;
    await call(`${base}/tasks/${ids[taskName]}`, 'PATCH', {
      predecessors: preds.map((p) => ({ task: ids[p], type: 'FS', lag: 0 })),
      resources: resources.map((r) => res[r]),
      percentComplete: pct,
    });
  }
  // Phase 2 attributes: statuses, categories, priorities, assignee — so boards and filters have data.
  const me = await call<{ user: { _id: string } }>('/auth/me');
  const ws = await call<{ statuses: { _id: string; name: string }[] }>('/work-settings');
  const statusId = (n: string) => ws.statuses.find((s) => s.name === n)?._id;
  const cats = await call<{ project: { categories: { _id: string; name: string }[] } }>(base, 'PATCH', {
    categories: [{ name: 'Design' }, { name: 'Civil' }, { name: 'MEP' }, { name: 'Interiors' }],
  });
  const catId = (n: string) => cats.project.categories.find((c) => c.name === n)?._id;
  const areas: Record<string, string> = {
    'Site survey': 'Design', 'Concept design': 'Design', 'Detailed drawings': 'Design', Demolition: 'Civil',
    'Partitions & ceilings': 'Civil', Flooring: 'Civil', 'Electrical wiring': 'MEP', 'HVAC ducting': 'MEP',
    'Fire safety systems': 'MEP', 'Order furniture': 'Interiors', 'Furniture installation': 'Interiors', 'Snagging & cleaning': 'Interiors',
  };
  for (const [taskName, , level, , , pct] of plan) {
    if (level !== 1) continue;
    await call(`${base}/tasks/${ids[taskName]}`, 'PATCH', {
      status: pct >= 100 ? statusId('Closed') : pct > 0 ? statusId('In progress') : statusId('New'),
      ...(areas[taskName] ? { category: catId(areas[taskName]) } : {}),
      ...(['Detailed drawings', 'Demolition', 'Fire safety systems'].includes(taskName) ? { priority: 'high' } : {}),
      ...(['Detailed drawings', 'Partitions & ceilings', 'Snagging & cleaning'].includes(taskName) ? { assignee: me.user._id } : {}),
    });
  }

  await call(`${base}/baselines`, 'POST', { name: 'Approved plan' });

  // Phase 3: a program containing this project, a life cycle with gates, a template and a favorite.
  const start = nextMonday();
  const { project: program } = await call<{ project: { _id: string } }>('/projects', 'POST', {
    name: DEMO_PROJECTS.program,
    description: 'All office fit-out and refurbishment projects for FY 2026-27.',
    startDate: start,
    kind: 'program',
  });
  const wsPhases = await call<{ phases: { _id: string }[] }>('/work-settings');
  const day = (n: number) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  await call(base, 'PATCH', {
    parent: program._id,
    lifecycle: wsPhases.phases.slice(0, 4).map((p, i) => ({
      definition: p._id,
      start: day(i * 12),
      finish: day(i * 12 + 11),
      gateStatus: i === 0 ? 'passed' : 'pending',
    })),
  });
  await call(`/projects/${project._id}/favorite`, 'POST');
  await call(`/projects/${program._id}/favorite`, 'POST');
  await call(`${base}/tasks/${ids['Detailed drawings']}/comments`, 'POST', {
    text: `Client asked for an extra meeting room on level 4 — drawings will take two more days. @[${name}](${me.user._id}) FYI`,
  });
  await call(`/projects/${project._id}/copy`, 'POST', {
    name: DEMO_PROJECTS.template,
    startDate: start,
    isTemplate: true,
    copy: { tasks: true, resources: false, members: false, views: true },
  });
  // Slip one task after the baseline so the comparison is visible.
  await call(`${base}/tasks/${ids['Detailed drawings']}`, 'PATCH', { duration: 8 });

  // A second, smaller project in the program so the portfolio roll-up has something to compare.
  const { project: lobby } = await call<{ project: { _id: string } }>('/projects', 'POST', {
    name: DEMO_PROJECTS.lobby,
    description: 'Refresh of the ground-floor reception: new desk, flooring, lighting and signage.',
    startDate: day(7),
    parent: program._id,
  });
  const lobbyBase = `/projects/${lobby._id}`;
  const lobbyPlan: [string, number, number][] = [
    ['Design brief', 3, 100],
    ['Furniture & finishes selection', 5, 60],
    ['Strip-out', 2, 0],
    ['Flooring & lighting', 6, 0],
    ['Reception desk installation', 3, 0],
    ['Signage & handover', 0, 0],
  ];
  let previous: string | null = null;
  for (const [taskName, duration, pct] of lobbyPlan) {
    const created = await call<Plan>(`${lobbyBase}/tasks`, 'POST', { name: taskName, duration });
    const taskId = created.createdTaskId!;
    await call(`${lobbyBase}/tasks/${taskId}`, 'PATCH', {
      percentComplete: pct,
      assignee: me.user._id,
      status: pct >= 100 ? statusId('Closed') : pct > 0 ? statusId('In progress') : statusId('New'),
      predecessors: previous ? [{ task: previous, type: 'FS', lag: 0 }] : [],
    });
    previous = taskId;
  }

  // Phases 4 & 5: estimates, a project hourly rate, time logged, material costs and a budget.
  type CostTypeRow = { _id: string; name: string };
  const ws4 = await call<{ activities: { _id: string; name: string }[]; costTypes: CostTypeRow[] }>('/work-settings');
  const wanted = [
    { name: 'Gypsum board', unit: 'sheet', unitRate: 450, color: '#64748b' },
    { name: 'Paint', unit: 'litre', unitRate: 320, color: '#0ea5e9' },
    { name: 'Electrical cable', unit: 'metre', unitRate: 85, color: '#f59e0b' },
  ];
  let costTypes = ws4.costTypes;
  for (const t of wanted) {
    // Cost types are organisation-wide: reuse them if they already exist.
    if (!costTypes.some((c) => c.name === t.name)) costTypes = (await call<{ costTypes: CostTypeRow[] }>('/work-settings/cost-types', 'POST', t)).costTypes;
  }
  const costType = (n: string) => costTypes.find((c) => c.name === n)!._id;
  const activity = (n: string) => ws4.activities.find((a) => a.name === n)?._id ?? null;

  await call(`${base}/rates`, 'POST', { user: me.user._id, rate: 1500, validFrom: day(-60) });
  const estimates: Record<string, number> = { 'Detailed drawings': 48, Demolition: 24, 'Partitions & ceilings': 64, Flooring: 40, 'Electrical wiring': 48 };
  for (const [taskName, work] of Object.entries(estimates)) {
    await call(`${base}/tasks/${ids[taskName]}`, 'PATCH', { work, remainingWork: Math.round(work * 0.6) });
  }
  const { budget } = await call<{ budget: { _id: string } }>(`${base}/budgets`, 'POST', {
    name: 'Civil & interiors',
    description: 'Approved budget for partitions, ceilings, flooring and finishes.',
    labor: [
      { label: 'Site engineer', user: me.user._id, hours: 120, rate: 1500 },
      { label: 'Carpentry crew', hours: 200, rate: 650 },
    ],
    material: [
      { costType: costType('Gypsum board'), units: 180 },
      { costType: costType('Paint'), units: 240 },
    ],
  });
  for (const taskName of ['Partitions & ceilings', 'Flooring', 'Demolition']) await call(`${base}/tasks/${ids[taskName]}`, 'PATCH', { budget: budget._id });
  const logs: [string, string, number, string, string][] = [
    ['Site survey', 'Site work', 6, day(0), 'Measured the floor plate with Rahul'],
    ['Concept design', 'Design', 7.5, day(2), 'Layout options A and B'],
    ['Concept design', 'Meetings', 2, day(4), 'Review with the client'],
    ['Detailed drawings', 'Design', 8, day(8), 'Reflected ceiling plan'],
    ['Demolition', 'Site work', 5, day(9), 'Supervised strip-out'],
    ['Order furniture', 'Procurement', 3, day(9), 'Requested three quotations'],
  ];
  for (const [taskName, act, hours, date, comment] of logs) {
    await call('/time-entries', 'POST', { project: project._id, task: ids[taskName], activity: activity(act), date, hours, comment });
  }
  await call(`${base}/cost-entries`, 'POST', { costType: costType('Gypsum board'), units: 60, date: day(9), task: ids['Partitions & ceilings'], comment: 'First delivery' });
  await call(`${base}/cost-entries`, 'POST', { costType: costType('Electrical cable'), units: 400, date: day(9), task: ids['Electrical wiring'], comment: 'FR cable, 2.5 sq mm' });

  console.log(`Done. Sign in as ${email}: open "${DEMO_PROJECTS.program}" or "${DEMO_PROJECTS.fitOut}".`);
  console.log('Remove the demo data later with: npm run seed:cleanup -- <apiUrl> <email> <password> --yes');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
