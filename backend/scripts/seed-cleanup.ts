/**
 * Deletes the demo data created by `seed:demo`: the demo projects owned by the given (admin) account
 * (their tasks, files, comments, baselines, time, costs and budgets go with them), the demo team
 * accounts, the placeholder and pending invitation, demo groups, the demo project role and global
 * role, demo custom fields, unused demo cost types and the demo project lists. Only items with the
 * demo names/emails from demo-names.ts are touched. Without --yes it only lists what would be deleted.
 *
 *   npm run seed:cleanup -- <apiUrl> <email> <password>          # dry run
 *   npm run seed:cleanup -- <apiUrl> <email> <password> --yes    # really delete
 */
import {
  DEMO_COST_TYPES,
  DEMO_CUSTOM_FIELDS,
  DEMO_GLOBAL_ROLE,
  DEMO_GROUPS,
  DEMO_INVITEE,
  DEMO_PLACEHOLDER,
  DEMO_PROJECT_LISTS,
  DEMO_PROJECT_NAMES,
  DEMO_ROLE,
  DEMO_TEAM,
} from './demo-names';

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const [apiUrl, email, password] = args.filter((a) => a !== '--yes');
let token = '';

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.error?.message}`);
  return data as T;
}

type Named = { _id: string; name: string };

async function main() {
  if (!apiUrl || !email || !password) {
    console.error('Usage: npm run seed:cleanup -- <apiUrl> <email> <password> [--yes]');
    process.exitCode = 1;
    return;
  }
  token = (await call<{ token: string }>('/auth/login', 'POST', { email, password })).token;
  const { user } = await call<{ user: { _id: string; role: string } }>('/auth/me');

  const { projects } = await call<{ projects: (Named & { owner: { _id: string } | null })[] }>('/projects');
  const { users } = await call<{ users: (Named & { email: string; kind?: string })[] }>('/users');
  const { groups } = await call<{ groups: Named[] }>('/groups');
  const { roles } = await call<{ roles: Named[] }>('/roles');
  const { roles: globalRoles } = await call<{ roles: Named[] }>('/global-roles');
  const ws = await call<{ customFields: Named[]; costTypes: Named[] }>('/work-settings');
  const { views } = await call<{ views: (Named & { owner: string })[] }>('/project-views');

  const demoEmails = new Set<string>([...DEMO_TEAM.map((m) => m.email), DEMO_INVITEE.email]);
  const plan: { label: string; items: Named[]; path: (id: string) => string; optional?: boolean }[] = [
    { label: 'projects', items: projects.filter((p) => DEMO_PROJECT_NAMES.includes(p.name) && p.owner?._id === user._id), path: (id) => `/projects/${id}` },
    { label: 'project lists', items: views.filter((v) => DEMO_PROJECT_LISTS.includes(v.name) && v.owner === user._id), path: (id) => `/project-views/${id}` },
    {
      label: 'demo people',
      items: users.filter((u) => demoEmails.has(u.email) || (u.kind === 'placeholder' && u.name === DEMO_PLACEHOLDER)),
      path: (id) => `/users/${id}`,
    },
    { label: 'groups', items: groups.filter((g) => DEMO_GROUPS.includes(g.name)), path: (id) => `/groups/${id}` },
    { label: 'project roles', items: roles.filter((r) => r.name === DEMO_ROLE), path: (id) => `/roles/${id}`, optional: true },
    { label: 'global roles', items: globalRoles.filter((r) => r.name === DEMO_GLOBAL_ROLE), path: (id) => `/global-roles/${id}` },
    { label: 'custom fields', items: ws.customFields.filter((f) => DEMO_CUSTOM_FIELDS.includes(f.name)), path: (id) => `/work-settings/custom-fields/${id}` },
    { label: 'cost types', items: ws.costTypes.filter((c) => DEMO_COST_TYPES.includes(c.name)), path: (id) => `/work-settings/cost-types/${id}`, optional: true },
  ];

  const total = plan.reduce((a, p) => a + p.items.length, 0);
  if (!total) {
    console.log('No demo data was found. Nothing to delete.');
    return;
  }
  if (user.role !== 'Admin') console.log('Note: only an administrator can remove the demo people, roles and work settings.\n');
  console.log(`${confirmed ? 'Deleting' : 'Would delete'}:`);
  for (const p of plan) if (p.items.length) console.log(`  ${p.label}: ${p.items.map((i) => i.name).join(', ')}`);
  if (!confirmed) {
    console.log('\nDry run only. Add --yes to delete them.');
    return;
  }
  for (const p of plan) {
    for (const item of p.items) {
      try {
        await call(p.path(item._id), 'DELETE');
      } catch (err) {
        // Still in use outside the demo (e.g. a cost type used by real entries): keep it.
        if (!p.optional) throw err;
        console.log(`  kept ${item.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  console.log('Done. The demo data has been removed.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
