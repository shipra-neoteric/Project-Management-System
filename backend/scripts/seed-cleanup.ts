/**
 * Deletes the demo data created by `seed:demo` — only projects with the demo names that the given
 * account owns (their tasks, files, comments, baselines and resources are deleted with them).
 * Nothing else is touched. Without --yes it only lists what would be deleted.
 *
 *   npm run seed:cleanup -- <apiUrl> <email> <password>          # dry run
 *   npm run seed:cleanup -- <apiUrl> <email> <password> --yes    # really delete
 */
import { DEMO_PROJECT_NAMES } from './demo-names';

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
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.error?.message}`);
  return data as T;
}

async function main() {
  if (!apiUrl || !email || !password) {
    console.error('Usage: npm run seed:cleanup -- <apiUrl> <email> <password> [--yes]');
    process.exit(1);
  }
  token = (await call<{ token: string }>('/auth/login', 'POST', { email, password })).token;
  const { user } = await call<{ user: { _id: string } }>('/auth/me');
  const { projects } = await call<{ projects: { _id: string; name: string; owner: { _id: string } | null; myRole: string }[] }>('/projects');

  const targets = projects.filter((p) => DEMO_PROJECT_NAMES.includes(p.name) && p.owner?._id === user._id);
  if (!targets.length) {
    console.log('No demo projects owned by this account were found. Nothing to delete.');
    return;
  }
  console.log(`${confirmed ? 'Deleting' : 'Would delete'} ${targets.length} demo project(s):`);
  for (const p of targets) console.log(`  - ${p.name} (${p._id})`);
  if (!confirmed) {
    console.log('\nDry run only. Add --yes to delete them.');
    return;
  }
  for (const p of targets) await call(`/projects/${p._id}`, 'DELETE');
  console.log('Done. The demo data has been removed.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
