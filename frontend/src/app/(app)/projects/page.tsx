'use client';

import { Archive, Bookmark, ChevronDown, ChevronRight, Columns3, Download, FolderKanban, FolderOpen, LayoutTemplate, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { Sec } from '@/components/ui/Field';
import { FilterTabs, KpiCard, KpiGrid, Page, PageHeader, SearchInput } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { ProjectDrawer } from '@/features/ProjectDrawer';
import { useDeleteProject, useFavorite, useProjects, useProjectViews, useWorkSettings } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate, todayISO } from '@/lib/dates';
import { EMPTY_CONFIG, formatCustomValue } from '@/lib/query';
import { atLeast, KIND_LABEL, PROJECT_ROLE, PROJECT_STATUS } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import type { CustomField, Project, ProjectKind, ProjectStatus, SavedView, UserRef, ViewConfig } from '@/lib/types';

type Scope = 'all' | 'favorites' | 'templates' | 'archived';
const BASE_COLUMNS = [
  { key: 'status', label: 'Status' },
  { key: 'start', label: 'Start' },
  { key: 'finish', label: 'Finish' },
  { key: 'progress', label: 'Progress' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'owner', label: 'Owner' },
  { key: 'role', label: 'Your role' },
];
const DEFAULT_COLUMNS = ['status', 'finish', 'progress', 'tasks', 'role'];
const th = 'px-3 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap';
const td = 'px-3 sm:px-4 py-3';
const parentOf = (p: Project) => (p.parent && typeof p.parent === 'object' ? p.parent._id : p.parent) ?? null;

export default function ProjectsPage() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const { themeColor } = useTheme();
  const { data: projects = [], isLoading, error } = useProjects();
  const { data: ws } = useWorkSettings();
  const views = useProjectViews();
  const remove = useDeleteProject();
  const favorite = useFavorite();
  const [scope, setScope] = useState<Scope>('all');
  const [config, setConfig] = useState<ViewConfig>({ ...EMPTY_CONFIG, columns: DEFAULT_COLUMNS });
  const [activeView, setActiveView] = useState<SavedView | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const projectFields: CustomField[] = (ws?.customFields ?? []).filter((f) => f.scope === 'project');
  const statusFilter = (config.filters.find((f) => f.field === 'status')?.value as string[] | undefined) ?? [];
  const kindFilter = (config.filters.find((f) => f.field === 'kind')?.value as string[] | undefined) ?? [];
  const setFilter = (field: string, value: string[]) =>
    setConfig((c) => ({ ...c, filters: [...c.filters.filter((f) => f.field !== field), ...(value.length ? [{ field, op: 'in', value }] : [])] }));

  useEffect(() => {
    if (activeView) setConfig({ ...EMPTY_CONFIG, ...activeView.config, columns: activeView.config.columns?.length ? activeView.config.columns : DEFAULT_COLUMNS });
  }, [activeView]);

  const counts = useMemo(
    () => ({
      all: projects.filter((p) => !p.isTemplate && p.status !== 'archived').length,
      favorites: projects.filter((p) => p.favorite).length,
      templates: projects.filter((p) => p.isTemplate).length,
      archived: projects.filter((p) => p.status === 'archived' && !p.isTemplate).length,
      active: projects.filter((p) => p.status === 'active' && !p.isTemplate).length,
    }),
    [projects],
  );

  const q = config.search.trim().toLowerCase();
  const filtered = projects.filter((p) => {
    if (scope === 'favorites' && !p.favorite) return false;
    if (scope === 'templates' && !p.isTemplate) return false;
    if (scope === 'archived' && (p.status !== 'archived' || p.isTemplate)) return false;
    if (scope === 'all' && (p.isTemplate || p.status === 'archived')) return false;
    if (statusFilter.length && !statusFilter.includes(p.status)) return false;
    if (kindFilter.length && !kindFilter.includes(p.kind)) return false;
    if (q && !`${p.name} ${p.key} ${p.description}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // Tree when nothing narrows the list; otherwise a flat list.
  const treeMode = scope === 'all' && !q && !statusFilter.length && !kindFilter.length;
  const rows = useMemo(() => {
    if (!treeMode) return filtered.map((p) => ({ project: p, depth: 0, hasChildren: false }));
    const ids = new Set(filtered.map((p) => p._id));
    const children = new Map<string, Project[]>();
    for (const p of filtered) {
      const parent = parentOf(p);
      const key = parent && ids.has(parent) ? parent : '';
      if (!children.has(key)) children.set(key, []);
      children.get(key)!.push(p);
    }
    const out: { project: Project; depth: number; hasChildren: boolean }[] = [];
    const walk = (key: string, depth: number) => {
      for (const p of (children.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
        const has = (children.get(p._id)?.length ?? 0) > 0;
        out.push({ project: p, depth, hasChildren: has });
        if (has && !collapsed.has(p._id) && depth < 10) walk(p._id, depth + 1);
      }
    };
    walk('', 0);
    return out;
  }, [filtered, treeMode, collapsed]);

  const people = (p: Project) => new Map<string, UserRef>([[p.owner?._id, p.owner], ...p.members.filter((m) => m.user).map((m) => [m.user._id, m.user] as [string, UserRef])]);
  const allColumns = [...BASE_COLUMNS, ...projectFields.map((f) => ({ key: `cf:${f._id}`, label: f.name }))];
  const columns = allColumns.filter((c) => config.columns.includes(c.key));

  const cell = (p: Project, key: string) => {
    const r = p.rollup;
    switch (key) {
      case 'status':
        return (
          <Badge tone={PROJECT_STATUS[p.status].tone} dot>
            {PROJECT_STATUS[p.status].label}
          </Badge>
        );
      case 'start':
        return fmtDate(r?.startDate ?? p.startDate);
      case 'finish':
        return fmtDate(r?.finishDate ?? p.finishDate);
      case 'progress':
        return (
          <span className="flex items-center gap-2 w-36">
            <ProgressBar value={r?.percentComplete ?? p.stats.percentComplete} />
            <span className="text-xs tabular-nums w-9 text-right">{r?.percentComplete ?? p.stats.percentComplete}%</span>
          </span>
        );
      case 'tasks':
        return (
          <span className="tabular-nums">
            {r?.taskCount ?? p.stats.taskCount}
            {(r?.overdueCount ?? p.stats.overdueCount) > 0 && <span className="text-red-500"> · {r?.overdueCount ?? p.stats.overdueCount} late</span>}
          </span>
        );
      case 'owner':
        return p.owner?.name;
      case 'role':
        return <Badge tone={PROJECT_ROLE[p.myRole].tone}>{PROJECT_ROLE[p.myRole].label}</Badge>;
      default: {
        const f = projectFields.find((x) => `cf:${x._id}` === key);
        return f ? formatCustomValue(f, p.customValues?.[f._id], people(p)) : '';
      }
    }
  };

  const exportCsv = () => {
    const header = ['Key', 'Name', 'Type', 'Parent', ...columns.map((c) => c.label)];
    const text = (p: Project, key: string): string => {
      const r = p.rollup;
      switch (key) {
        case 'status':
          return PROJECT_STATUS[p.status].label;
        case 'start':
          return r?.startDate ?? p.startDate;
        case 'finish':
          return r?.finishDate ?? p.finishDate;
        case 'progress':
          return `${r?.percentComplete ?? p.stats.percentComplete}%`;
        case 'tasks':
          return String(r?.taskCount ?? p.stats.taskCount);
        case 'owner':
          return p.owner?.name ?? '';
        case 'role':
          return PROJECT_ROLE[p.myRole].label;
        default: {
          const f = projectFields.find((x) => `cf:${x._id}` === key);
          return f ? formatCustomValue(f, p.customValues?.[f._id], people(p)) : '';
        }
      }
    };
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [header.join(',')];
    for (const { project: p } of rows) {
      const parent = p.parent && typeof p.parent === 'object' ? p.parent.name : '';
      lines.push([p.key, p.name, KIND_LABEL[p.kind], parent, ...columns.map((c) => text(p, c.key))].map((v) => esc(String(v ?? ''))).join(','));
    }
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `projects-${todayISO()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveView = async (asNew = false) => {
    if (!asNew && activeView && (activeView.owner === user?._id || isAdmin)) {
      try {
        setActiveView(await views.update.mutateAsync({ id: activeView._id, config }));
        void toastSuccess('List updated');
      } catch (err) {
        void toastError(errorMessage(err));
      }
      return;
    }
    const Swal = (await import('sweetalert2')).default;
    const result = await Swal.fire({ title: 'Save this list', input: 'text', inputLabel: 'Name', showCancelButton: true, confirmButtonText: 'Save', confirmButtonColor: themeColor, inputValidator: (v) => (!v.trim() ? 'Enter a name' : undefined) });
    if (!result.isConfirmed) return;
    try {
      setActiveView(await views.create.mutateAsync({ name: String(result.value).trim(), isPublic: false, config }));
      void toastSuccess('List saved');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const onDelete = async (p: Project) => {
    if (!(await confirmDanger(`Delete "${p.name}"?`, 'All tasks, files, history and resources in this project will be permanently deleted. Sub-projects are kept.'))) return;
    try {
      await remove.mutateAsync(p._id);
      void toastSuccess('Project deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Page>
      <PageHeader
        title="Projects"
        subtitle="Portfolios, programs and projects you own or have been invited to"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>
            New project
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="Projects" value={counts.all} icon={FolderKanban} iconColor="text-blue-500" active={scope === 'all'} onClick={() => setScope('all')} />
        <KpiCard label="Active" value={counts.active} icon={FolderOpen} iconColor="text-green-500" />
        <KpiCard label="Favorites" value={counts.favorites} icon={Star} iconColor="text-amber-500" active={scope === 'favorites'} onClick={() => setScope('favorites')} />
        <KpiCard label="Templates" value={counts.templates} icon={LayoutTemplate} iconColor="text-purple-500" active={scope === 'templates'} onClick={() => setScope('templates')} />
      </KpiGrid>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2">
        <div className="w-48">
          <ThemedSelect
            compact
            options={[{ value: '', label: 'All projects (default)' }, ...(views.data ?? []).map((v) => ({ value: v._id, label: v.name, description: v.isPublic ? 'Shared' : 'Private' }))]}
            value={activeView?._id ?? ''}
            onChange={(id) => {
              const v = views.data?.find((x) => x._id === id) ?? null;
              setActiveView(v);
              if (!v) setConfig({ ...EMPTY_CONFIG, columns: DEFAULT_COLUMNS });
            }}
          />
        </div>
        <Button size="sm" icon={Save} onClick={() => void saveView()} loading={views.create.isPending || views.update.isPending}>
          {activeView ? 'Save' : 'Save list'}
        </Button>
        {activeView && <IconButton icon={Bookmark} label="Save as a new list" onClick={() => void saveView(true)} />}
        {activeView && (activeView.owner === user?._id || isAdmin) && (
          <IconButton
            icon={Trash2}
            label="Delete this saved list"
            className="hover:!text-red-500"
            onClick={async () => {
              if (!(await confirmDanger(`Delete the list "${activeView.name}"?`))) return;
              await views.remove.mutateAsync(activeView._id);
              setActiveView(null);
            }}
          />
        )}
        <SearchInput value={config.search} onChange={(search) => setConfig((c) => ({ ...c, search }))} placeholder="Search projects…" />
        <div className="w-40">
          <ThemedSelect
            compact
            options={[{ value: '', label: 'Any status' }, ...(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({ value: s, label: PROJECT_STATUS[s].label }))]}
            value={statusFilter[0] ?? ''}
            onChange={(v) => setFilter('status', v ? [v] : [])}
          />
        </div>
        <div className="w-40">
          <ThemedSelect
            compact
            options={[{ value: '', label: 'Any type' }, ...(Object.keys(KIND_LABEL) as ProjectKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
            value={kindFilter[0] ?? ''}
            onChange={(v) => setFilter('kind', v ? [v] : [])}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={Columns3} onClick={() => setColumnsOpen(true)}>
            Columns
          </Button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      <FilterTabs<Scope>
        value={scope}
        onChange={setScope}
        tabs={[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'favorites', label: 'Favorites', icon: Star, count: counts.favorites },
          { key: 'templates', label: 'Templates', icon: LayoutTemplate, count: counts.templates },
          { key: 'archived', label: 'Archived', icon: Archive, count: counts.archived },
        ]}
      />

      {error && <Alert>{errorMessage(error)}</Alert>}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={projects.length ? 'No matching projects' : 'No projects yet'}
            message={scope === 'templates' ? 'Tick "Use as a template" on a project to reuse its plan.' : projects.length ? 'Try another tab or clear the filters.' : 'Create a project to start planning.'}
            action={!projects.length && <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create first project</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className={th}>Name</th>
                  {columns.map((c) => (
                    <th key={c.key} className={th}>
                      {c.label}
                    </th>
                  ))}
                  <th className={`${th} text-right w-24`}>Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {rows.map(({ project: p, depth, hasChildren }) => (
                  <tr key={p._id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group cursor-pointer" onClick={() => router.push(`/projects/${p._id}${p.kind === 'project' ? '' : '/overview'}`)}>
                    <td className={td}>
                      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: depth * 20 }}>
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(p._id)) next.delete(p._id);
                                else next.add(p._id);
                                return next;
                              });
                            }}
                            className="p-0.5 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600"
                            aria-label={collapsed.has(p._id) ? 'Expand' : 'Collapse'}
                          >
                            {collapsed.has(p._id) ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        ) : (
                          treeMode && <span className="w-5" />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            favorite.mutate({ projectId: p._id, on: !p.favorite });
                          }}
                          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                          aria-label={p.favorite ? 'Remove from favorites' : 'Add to favorites'}
                          title={p.favorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star className="w-4 h-4" style={p.favorite ? { color: themeColor, fill: themeColor } : { color: 'rgb(209 213 219)' }} />
                        </button>
                        <div className="min-w-0">
                          <p className={cn('text-sm text-gray-900 dark:text-white truncate', p.kind === 'project' ? 'font-medium' : 'font-semibold')}>{p.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                            <span className="font-mono">{p.key}</span>
                            {p.kind !== 'project' && <Badge tone="purple" className="py-0">{KIND_LABEL[p.kind]}</Badge>}
                            {p.isTemplate && <Badge tone="info" className="py-0">Template</Badge>}
                            {p.kind !== 'project' && p.rollup && p.rollup.projectCount > 0 && <span>{p.rollup.projectCount} sub-projects</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={`${td} text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>
                        {cell(p, c.key)}
                      </td>
                    ))}
                    <td className={`${td} text-right whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        {atLeast(p.myRole, 'manager') && <IconButton icon={Pencil} label="Edit project" tone="edit" onClick={() => setEditing(p)} />}
                        {p.myRole === 'owner' && <IconButton icon={Trash2} label="Delete project" tone="delete" onClick={() => onDelete(p)} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        icon={Columns3}
        title="Columns"
        width="md"
        footer={
          <Button inDrawer variant="primary" onClick={() => setColumnsOpen(false)}>
            Done
          </Button>
        }
      >
        <Sec title="Show these columns" />
        <div className="grid grid-cols-2 gap-2">
          {allColumns.map((c) => {
            const on = config.columns.includes(c.key);
            return (
              <label key={c.key} className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={on}
                  className="w-4 h-4 accent-[var(--theme-primary)]"
                  onChange={() => setConfig((cfg) => ({ ...cfg, columns: on ? cfg.columns.filter((k) => k !== c.key) : [...cfg.columns, c.key] }))}
                />
                {c.label}
              </label>
            );
          })}
        </div>
      </Drawer>

      <ProjectDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
      <ProjectDrawer open={!!editing} project={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}
