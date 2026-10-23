'use client';

import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp, Download, Plus, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { TypeLabel } from '@/components/ui/TaskBits';
import { BulkBar } from '@/components/views/BulkBar';
import { TaskCell } from '@/components/views/TaskCell';
import { useViewState } from '@/components/views/useViewState';
import { ViewToolbar } from '@/components/views/ViewToolbar';
import { useWorkspace } from '@/features/project-context';
import { useTaskMutations } from '@/features/queries';
import { toastError } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { exportCsv } from '@/lib/export';
import { FIELD_MAP, groupRows, runQuery } from '@/lib/query';
import { useTheme } from '@/lib/theme';

const DEFAULTS = { columns: ['id', 'type', 'status', 'priority', 'assignee', 'start', 'finish', 'percentComplete'] };
const th = 'px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap';

export default function TablePage() {
  const { projectId, plan, tasks, resources, ctx, canEdit, isLoading, error, openTask } = useWorkspace();
  const viewState = useViewState(projectId, 'table', DEFAULTS);
  const { config, setConfig } = viewState;
  const { create } = useTaskMutations(projectId);
  const { themeColor } = useTheme();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  const rows = useMemo(() => (ctx ? runQuery(tasks, config, ctx) : []), [tasks, config, ctx]);
  const groups = useMemo(() => (ctx ? groupRows(rows, config.groupBy, ctx) : []), [rows, config.groupBy, ctx]);
  const columns = config.columns.filter((c) => FIELD_MAP.has(c) && c !== 'name');

  if (isLoading) return <PageLoader label="Loading tasks…" />;
  if (error || !ctx || !plan) return <Alert>{errorMessage(error, 'Could not load tasks')}</Alert>;

  const toggleSort = (field: string) => {
    if (!FIELD_MAP.get(field)?.sortable) return;
    setConfig((c) => {
      const current = c.sort[0];
      if (current?.field !== field) return { ...c, sort: [{ field, dir: 'asc' }] };
      if (current.dir === 'asc') return { ...c, sort: [{ field, dir: 'desc' }] };
      return { ...c, sort: [] };
    });
  };

  const addTask = async () => {
    const Swal = (await import('sweetalert2')).default;
    const result = await Swal.fire({
      title: 'New task',
      input: 'text',
      inputLabel: 'Task name (added at the end of the plan)',
      inputValidator: (v) => (!v.trim() ? 'Enter a name' : undefined),
      showCancelButton: true,
      confirmButtonText: 'Create',
      confirmButtonColor: themeColor,
    });
    if (!result.isConfirmed) return;
    try {
      const res = await create.mutateAsync({ name: String(result.value).trim(), duration: 1 });
      openTask(res.createdTaskId);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const allChecked = rows.length > 0 && rows.every((t) => checked.has(t._id));
  const resourceNames = new Map(resources.map((r) => [r._id, r.name]));

  return (
    <div className="space-y-3">
      <ViewToolbar kind="table" state={viewState} features={{ sort: true, group: true, columns: true }}>
        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          {rows.length} of {tasks.length} tasks
        </span>
        <button
          type="button"
          onClick={() => exportCsv(plan.project, rows, resourceNames)}
          disabled={!rows.length}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-40"
        >
          <Download className="w-4 h-4" /> Excel
        </button>
        {canEdit && (
          <Button size="sm" variant="primary" icon={Plus} onClick={addTask}>
            Task
          </Button>
        )}
      </ViewToolbar>

      <BulkBar selected={[...checked].filter((id) => tasks.some((t) => t._id === id))} onClear={() => setChecked(new Set())} />

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={Table2} title={tasks.length ? 'No tasks match the current filters' : 'No tasks yet'} message={tasks.length ? 'Adjust the filters in View options.' : 'Add tasks here or on the Gantt chart.'} />
        ) : (
          <div className="overflow-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 340px)' }}>
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0 z-10">
                <tr>
                  {canEdit && (
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((t) => t._id)))}
                        className="w-4 h-4 accent-[var(--theme-primary)]"
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  {['name', ...columns].map((field) => {
                    const def = FIELD_MAP.get(field)!;
                    const sort = config.sort[0]?.field === field ? config.sort[0].dir : null;
                    return (
                      <th key={field} className={cn(th, def.sortable && 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors')} style={{ minWidth: def.width }} onClick={() => toggleSort(field)}>
                        <span className="flex items-center gap-1">
                          {def.label}
                          {def.sortable &&
                            (sort === 'asc' ? <ChevronUp className="w-3 h-3" /> : sort === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3 text-gray-300 dark:text-gray-600" />)}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                {groups.map((g) => {
                  const closed = closedGroups.has(g.key);
                  return [
                    config.groupBy ? (
                      <tr key={`g-${g.key}`} className="bg-gray-50/70 dark:bg-gray-900/40">
                        <td colSpan={columns.length + 2} className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setClosedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.key)) next.delete(g.key);
                              else next.add(g.key);
                              return next;
                            })}
                            className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100"
                          >
                            {closed ? <ChevronRight className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                            {g.color && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />}
                            {g.label}
                            <span className="text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5 tabular-nums">{g.tasks.length}</span>
                          </button>
                        </td>
                      </tr>
                    ) : null,
                    ...(closed
                      ? []
                      : g.tasks.map((t) => (
                          <tr
                            key={t._id}
                            onClick={() => openTask(t._id)}
                            className={cn('cursor-pointer transition-colors', checked.has(t._id) ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50')}
                          >
                            {canEdit && (
                              <td className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={checked.has(t._id)}
                                  onChange={() =>
                                    setChecked((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(t._id)) next.delete(t._id);
                                      else next.add(t._id);
                                      return next;
                                    })
                                  }
                                  className="w-4 h-4 accent-[var(--theme-primary)]"
                                  aria-label={`Select ${t.name}`}
                                />
                              </td>
                            )}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2 min-w-0">
                                {!columns.includes('type') && <TypeLabel type={t.type ? ctx.types.get(t.type) : undefined} />}
                                <span className={cn('text-sm text-gray-900 dark:text-white truncate max-w-md', t.isSummary ? 'font-semibold' : 'font-medium')}>{t.name}</span>
                              </div>
                            </td>
                            {columns.map((field) => (
                              <td key={field} className="px-3 py-2.5">
                                <TaskCell field={field} task={t} ctx={ctx} />
                              </td>
                            ))}
                          </tr>
                        ))),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
