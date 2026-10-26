'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronRight, Download, ScrollText, ShieldAlert, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { inputCls } from '@/components/ui/Field';
import { Card, KpiCard, KpiGrid, Page, PageHeader, SearchInput, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { keys, useProjects, useUsers } from '@/features/queries';
import { toastError } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/dates';
import { exportFileName, exportXlsx } from '@/lib/export';
import { can } from '@/lib/permissions';
import type { Project } from '@/lib/types';

interface AuditEntry {
  _id: string;
  at: string;
  category: 'change' | 'security';
  type: string;
  action: string;
  resource: string;
  method: string;
  path: string;
  status: number;
  actor: string | null;
  actorName: string;
  project: string | null;
  projectName: string;
  entityId: string | null;
  summary: string;
  requestId: string;
  ip: string;
  userAgent: string;
  body: unknown;
}

interface Filters {
  from: string;
  to: string;
  user: string;
  project: string;
  type: string;
  category: '' | 'change' | 'security';
  q: string;
}

const ACTION_TONE: Record<string, BadgeTone> = { created: 'success', updated: 'info', deleted: 'danger', login: 'success', login_failed: 'danger', '2fa_failed': 'danger' };

const query = (f: Filters, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v) as [string, string][]);
  return params.toString() ? `?${params}` : '';
};

/** The changed values of an entry as "field: value" lines (secrets were redacted by the server). */
function bodyLines(body: unknown): [string, string][] {
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;
  const source = b.patch && typeof b.patch === 'object' ? { ...(b.patch as Record<string, unknown>), ...(b.taskIds ? { tasks: `${(b.taskIds as unknown[]).length} selected` } : {}) } : b;
  return Object.entries(source).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
}

export default function AuditPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AuditTrail />
    </Suspense>
  );
}

function AuditTrail() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const scopedProject = params.get('project') ?? '';
  const project = useQuery({
    queryKey: keys.project(scopedProject),
    queryFn: async () => (await api<{ project: Project }>(`/projects/${scopedProject}`)).project,
    enabled: !!scopedProject,
  });
  const projectAllowed = !!scopedProject && can(project.data, 'manage_project');
  const allowed = isAdmin || projectAllowed;

  const [filters, setFilters] = useState<Filters>({ from: '', to: '', user: '', project: scopedProject, type: '', category: '', q: '' });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: search.trim() })), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setFilters((f) => ({ ...f, project: scopedProject })), [scopedProject]);

  useEffect(() => {
    if (!user || isAdmin || (scopedProject && project.isLoading)) return;
    if (!projectAllowed) {
      router.replace(scopedProject ? `/projects/${scopedProject}` : '/dashboard');
      void toastError('Access denied: the audit trail is for administrators and project managers');
    }
  }, [user, isAdmin, scopedProject, project.isLoading, projectAllowed, router]);

  const users = useUsers();
  const projects = useProjects();
  const stats = useQuery({
    queryKey: ['audit-stats', filters.project],
    queryFn: () => api<{ changesToday: number; activeUsers: number; failedLogins: number; types: string[] }>(`/audit/stats${filters.project ? `?project=${filters.project}` : ''}`),
    enabled: allowed,
  });
  const list = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => api<{ entries: AuditEntry[]; nextCursor: string | null }>(`/audit${query(filters, pageParam ? { before: pageParam } : {})}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
  });
  const entries = useMemo(() => list.data?.pages.flatMap((p) => p.entries) ?? [], [list.data]);

  if (!allowed) return <PageLoader />;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const reset = () => {
    setSearch('');
    setFilters({ from: '', to: '', user: '', project: scopedProject, type: '', category: '', q: '' });
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { entries: rows } = await api<{ entries: AuditEntry[] }>(`/audit${query(filters, { limit: '5000' })}`);
      await exportXlsx(exportFileName(scopedProject ? `${project.data?.name ?? 'Project'} audit trail` : 'Audit trail', 'xlsx'), [
        {
          name: 'Audit trail',
          header: ['When (UTC)', 'Person', 'What happened', 'Event', 'Project', 'Category', 'Method', 'Path', 'Status', 'IP address', 'Request id'],
          rows: rows.map((e) => [e.at.replace('T', ' ').slice(0, 19), e.actorName, e.summary, e.type, e.projectName, e.category, e.method, e.path, e.status, e.ip, e.requestId]),
          widths: [20, 22, 70, 24, 28, 10, 8, 40, 8, 16, 38],
        },
      ]);
    } catch (err) {
      void toastError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const personOptions = [{ value: '', label: 'Everyone' }, ...(users.data ?? []).filter((u) => u.kind !== 'placeholder').map((u) => ({ value: u._id, label: u.name, description: u.email }))];
  const projectOptions = [{ value: '', label: 'All projects' }, ...(projects.data ?? []).map((p) => ({ value: p._id, label: p.name }))];
  const typeOptions = [{ value: '', label: 'Any event' }, ...(stats.data?.types ?? []).map((t) => ({ value: t, label: t }))];
  const filtered = Object.entries(filters).some(([k, v]) => v && !(k === 'project' && v === scopedProject));

  return (
    <Page>
      <PageHeader
        breadcrumbs={scopedProject && project.data ? [{ label: 'Projects', href: '/projects' }, { label: project.data.name, href: `/projects/${scopedProject}/activity` }, { label: 'Audit trail' }] : undefined}
        title="Audit trail"
        subtitle={
          scopedProject
            ? 'Every change made in this project: who did what, when and from where.'
            : `Every change made through the app, plus sign-ins. Entries are kept for the retention period set on the server (default one year).`
        }
        actions={
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || !entries.length}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Excel'}
          </button>
        }
      />

      <KpiGrid>
        <KpiCard label="Changes today" value={stats.data?.changesToday ?? '—'} icon={Activity} iconColor="text-blue-500" />
        <KpiCard label="Active people today" value={stats.data?.activeUsers ?? '—'} icon={Users} iconColor="text-green-500" />
        {isAdmin && !scopedProject ? (
          <KpiCard
            label="Failed sign-ins (24 h)"
            value={stats.data?.failedLogins ?? '—'}
            icon={ShieldAlert}
            iconColor={stats.data?.failedLogins ? 'text-red-500' : 'text-gray-400'}
            active={filters.type === 'auth.login_failed'}
            onClick={() => set('type', filters.type === 'auth.login_failed' ? '' : 'auth.login_failed')}
          />
        ) : (
          <KpiCard label="Event types" value={stats.data?.types.length ?? '—'} icon={ShieldAlert} iconColor="text-purple-500" />
        )}
        <KpiCard label="Entries shown" value={`${entries.length}${list.hasNextPage ? '+' : ''}`} icon={ScrollText} iconColor="text-amber-500" />
      </KpiGrid>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search what happened…" />
        <div className="w-44">
          <ThemedSelect compact options={personOptions} value={filters.user} onChange={(v) => set('user', v)} searchable />
        </div>
        {!scopedProject && (
          <div className="w-52">
            <ThemedSelect compact options={projectOptions} value={filters.project} onChange={(v) => set('project', v)} searchable />
          </div>
        )}
        <div className="w-48">
          <ThemedSelect compact options={typeOptions} value={filters.type} onChange={(v) => set('type', v)} searchable />
        </div>
        {isAdmin && !scopedProject && (
          <div className="w-36">
            <ThemedSelect
              compact
              options={[
                { value: '', label: 'All categories' },
                { value: 'change', label: 'Changes' },
                { value: 'security', label: 'Security' },
              ]}
              value={filters.category}
              onChange={(v) => set('category', v as Filters['category'])}
            />
          </div>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          From
          <input type="date" className={`${inputCls} !h-8 !w-36`} value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          To
          <input type="date" className={`${inputCls} !h-8 !w-36`} value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
        </label>
        {filtered && (
          <Button size="sm" variant="ghost" onClick={reset}>
            Clear
          </Button>
        )}
      </div>

      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      <Card>
        {list.isLoading ? (
          <PageLoader />
        ) : entries.length === 0 ? (
          <EmptyState icon={ScrollText} title="No entries" message={filtered ? 'Nothing matches these filters.' : 'Changes will be recorded here as people work.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={`${th} w-8`} aria-label="Details" />
                  <th className={th}>When</th>
                  <th className={th}>What happened</th>
                  <th className={`${th} hidden md:table-cell`}>Event</th>
                  {!scopedProject && <th className={`${th} hidden lg:table-cell`}>Project</th>}
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {entries.map((e) => {
                  const expanded = open === e._id;
                  const action = e.category === 'security' ? e.type.replace('auth.', '') : e.action;
                  return (
                    <Fragment key={e._id}>
                      <tr className={`${rowCls} cursor-pointer`} onClick={() => setOpen(expanded ? null : e._id)} aria-expanded={expanded}>
                        <td className={`${td} text-gray-400`}>{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                        <td className={`${td} text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap tabular-nums`}>{fmtDateTime(e.at)}</td>
                        <td className={`${td} text-sm text-gray-900 dark:text-white`}>
                          {e.summary || `${e.actorName || 'Someone'} ${e.action} ${e.resource}`}
                        </td>
                        <td className={`${td} hidden md:table-cell whitespace-nowrap`}>
                          <Badge tone={e.category === 'security' && action.includes('failed') ? 'danger' : (ACTION_TONE[action] ?? 'neutral')}>{e.type}</Badge>
                        </td>
                        {!scopedProject && <td className={`${td} hidden lg:table-cell text-sm text-gray-600 dark:text-gray-300`}>{e.projectName || '—'}</td>}
                      </tr>
                      {expanded && (
                        <tr className="bg-gray-50 dark:bg-gray-900/40">
                          <td />
                          <td colSpan={scopedProject ? 3 : 4} className="px-3 sm:px-6 py-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
                              <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5">
                                {(
                                  [
                                    ['Person', e.actorName || '—'],
                                    ['Request', `${e.method} ${e.path} → ${e.status}`],
                                    ['IP address', e.ip || '—'],
                                    ['Browser', e.userAgent || '—'],
                                    ['Request id', e.requestId || '—'],
                                    ['Record id', e.entityId || '—'],
                                  ] as const
                                ).map(([k, v]) => (
                                  <Fragment key={k}>
                                    <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider pt-0.5">{k}</dt>
                                    <dd className="text-gray-800 dark:text-gray-200 break-all">{v}</dd>
                                  </Fragment>
                                ))}
                              </dl>
                              <div>
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Values sent</p>
                                {bodyLines(e.body).length ? (
                                  <dl className="rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
                                    {bodyLines(e.body).map(([k, v]) => (
                                      <div key={k} className="grid grid-cols-[140px_1fr] gap-3 px-3 py-1.5">
                                        <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                                        <dd className="font-mono text-xs text-gray-800 dark:text-gray-200 break-all">{v.length > 400 ? `${v.slice(0, 400)}…` : v}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                ) : (
                                  <p className="text-gray-400 dark:text-gray-500">No values (for example a deletion).</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
          <div className="p-3 border-t border-gray-100 dark:border-gray-700 flex justify-center">
            <Button size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              Load older entries
            </Button>
          </div>
        )}
      </Card>
    </Page>
  );
}
