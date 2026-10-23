/**
 * Creates a realistic sample project through the public API (works locally or against Render).
 *
 *   npm run seed:demo -- <apiUrl> <email> <password> [name]
 *   npm run seed:demo -- http://localhost:4000/api admin@example.com Password123 "Demo Admin"
 *
 * Signs in (or registers the account if it doesn't exist yet), then builds the plan.
 */
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
    token = (await call<{ token: string }>('/auth/register', 'POST', { name, email, password })).token;
  }

  const { project } = await call<{ project: { _id: string } }>('/projects', 'POST', {
    name: 'Corporate Office Fit-out',
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

  const ids: Record<string, string> = {};
  for (const [taskName, duration] of plan) {
    const r = await call<Plan>(`${base}/tasks`, 'POST', { name: taskName, duration: Math.max(duration, 0) });
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
  await call(`${base}/baseline`, 'POST');
  // Slip one task after the baseline so the comparison is visible.
  await call(`${base}/tasks/${ids['Detailed drawings']}`, 'PATCH', { duration: 8 });

  console.log(`Done. Sign in as ${email} and open "Corporate Office Fit-out".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
