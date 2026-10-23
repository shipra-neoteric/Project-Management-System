'use client';

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Diamond,
  Download,
  FileText,
  Flag,
  IndentDecrease,
  IndentIncrease,
  Loader2,
  Plus,
  RefreshCw,
  Route,
  Trash2,
} from 'lucide-react';
import { useIsMutating } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { FilterTabs } from '@/components/ui/Layout';
import { keys, usePlan, useResources, useTaskMutations, type TaskPatch } from '@/features/queries';
import { confirmDanger, toastError } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { todayISO } from '@/lib/dates';
import { exportCsv, exportPdf } from '@/lib/export';
import { atLeast } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import type { Task } from '@/lib/types';
import { GanttChart, HEADER_H, ROW_H, type Zoom } from './GanttChart';
import { parsePredecessors } from './predecessors';
import { GRID_DEFAULT_WIDTH, GRID_FULL_WIDTH, TaskGrid, type EditableField } from './TaskGrid';
import { TaskDrawer } from './TaskDrawer';

const MIN_GRID = 180;

function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);
  const update = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, update] as const;
}

export function GanttView({ projectId }: { projectId: string }) {
  const plan = usePlan(projectId);
  const resourcesQuery = useResources(projectId);
  const mutations = useTaskMutations(projectId);
  const saving = useIsMutating({ mutationKey: keys.plan(projectId) }) > 0;
  const { themeColor, isDark } = useTheme();
  const today = todayISO();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editRequest, setEditRequest] = useState<{ taskId: string; field: EditableField; nonce: number } | null>(null);
  const [zoom, setZoom] = usePersistentState<Zoom>('pms_gantt_zoom', 'day');
  const [showCritical, setShowCritical] = usePersistentState('pms_gantt_critical', false);
  const [showBaseline, setShowBaseline] = usePersistentState('pms_gantt_baseline', false);
  const [gridWidth, setGridWidth] = usePersistentState<number | null>('pms_gantt_grid_width', null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(1000);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientWidth));
    ro.observe(el);
    setViewport(el.clientWidth);
    return () => ro.disconnect();
  }, [plan.isSuccess]);

  const project = plan.data?.project;
  const tasks = useMemo(() => plan.data?.tasks ?? [], [plan.data?.tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t._id, t])), [tasks]);
  const resources = useMemo(() => resourcesQuery.data ?? [], [resourcesQuery.data]);
  const resourceNames = useMemo(() => new Map(resources.map((r) => [r._id, r.name])), [resources]);
  const canEdit = atLeast(project?.myRole, 'member');

  // Hide children of collapsed summaries.
  const rows = useMemo(() => {
    const hidden = new Set<string>();
    return tasks.filter((t) => {
      if (t.parent && (hidden.has(t.parent) || collapsed.has(t.parent))) {
        hidden.add(t._id);
        return false;
      }
      return true;
    });
  }, [tasks, collapsed]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const defaultGrid = viewport < 768 ? 230 : Math.min(GRID_DEFAULT_WIDTH, Math.round(viewport * 0.55));
  const effectiveGrid = Math.max(MIN_GRID, Math.min(gridWidth ?? defaultGrid, GRID_FULL_WIDTH, viewport - 60));

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      void toastError(errorMessage(err, 'The change could not be saved'));
    }
  }, []);

  const addTask = (milestone: boolean) =>
    run(async () => {
      const res = await mutations.create.mutateAsync({ name: milestone ? 'New milestone' : 'New task', duration: milestone ? 0 : 1, afterTaskId: selectedId });
      setSelectedId(res.createdTaskId);
      setEditRequest({ taskId: res.createdTaskId, field: 'name', nonce: Date.now() });
    });

  const move = (action: 'up' | 'down' | 'indent' | 'outdent') => selected && run(() => mutations.move.mutateAsync({ taskId: selected._id, action }));

  const deleteTask = useCallback(
    async (task: Task) => {
      const children = tasks.filter((t) => t.wbs.startsWith(`${task.wbs}.`)).length;
      const ok = await confirmDanger(`Delete "${task.name}"?`, children ? `Its ${children} sub-task${children === 1 ? '' : 's'} will be deleted too.` : 'Links to this task will be removed.');
      if (!ok) return;
      await run(() => mutations.remove.mutateAsync(task._id));
      setDrawerId(null);
      setSelectedId(null);
    },
    [tasks, mutations.remove, run],
  );

  const onCommit = useCallback(
    (task: Task, field: EditableField, value: string) => {
      let patch: TaskPatch;
      try {
        switch (field) {
          case 'name':
            if (!value) throw new Error('Task name cannot be empty');
            patch = { name: value };
            break;
          case 'duration': {
            const n = Number(value.replace(/\s*d(ays?)?$/i, ''));
            if (!Number.isInteger(n) || n < 0) throw new Error('Duration must be a whole number of days');
            patch = { duration: n };
            break;
          }
          case 'percentComplete': {
            const n = Number(value.replace('%', ''));
            if (Number.isNaN(n) || n < 0 || n > 100) throw new Error('% complete must be between 0 and 100');
            patch = { percentComplete: n };
            break;
          }
          case 'start':
            patch = { constraintStart: value || null };
            break;
          case 'predecessors':
            patch = { predecessors: parsePredecessors(value, tasks, task) };
            break;
        }
      } catch (err) {
        void toastError(errorMessage(err));
        return;
      }
      void run(() => mutations.update.mutateAsync({ taskId: task._id, patch }));
    },
    [tasks, mutations.update, run],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Drag the splitter between grid and chart.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = effectiveGrid;
    const onMove = (ev: PointerEvent) => setGridWidth(Math.max(MIN_GRID, Math.min(GRID_FULL_WIDTH, startW + ev.clientX - startX)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const scrollToToday = () => {
    const el = scrollRef.current;
    const line = el?.querySelector('svg[role="img"] line[stroke-dasharray]');
    if (el && line) el.scrollLeft = Math.max(0, Number(line.getAttribute('x1')) - 120);
  };

  if (plan.isLoading) return <PageLoader label="Loading plan…" />;
  if (plan.error || !project) return <Alert>{errorMessage(plan.error, 'Could not load the plan')}</Alert>;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2 no-print">
        {canEdit && (
          <>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => addTask(false)}>
              Task
            </Button>
            <Button size="sm" icon={Diamond} onClick={() => addTask(true)}>
              Milestone
            </Button>
            <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
            <IconButton icon={IndentDecrease} label="Outdent (move up a level)" disabled={!selected?.parent} onClick={() => move('outdent')} />
            <IconButton icon={IndentIncrease} label="Indent (make a sub-task of the task above)" disabled={!selected} onClick={() => move('indent')} />
            <IconButton icon={ArrowUp} label="Move up" disabled={!selected} onClick={() => move('up')} />
            <IconButton icon={ArrowDown} label="Move down" disabled={!selected} onClick={() => move('down')} />
            <IconButton icon={Trash2} label="Delete selected task" disabled={!selected} onClick={() => selected && deleteTask(selected)} className="hover:!text-red-500" />
            <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
          </>
        )}
        <FilterTabs<Zoom>
          value={zoom}
          onChange={setZoom}
          tabs={[
            { key: 'day', label: 'Days' },
            { key: 'week', label: 'Weeks' },
            { key: 'month', label: 'Months' },
          ]}
        />
        <IconButton icon={Flag} label="Scroll to today" onClick={scrollToToday} />
        <IconButton icon={Route} label={showCritical ? 'Hide critical path' : 'Show critical path'} active={showCritical} onClick={() => setShowCritical(!showCritical)} />
        <IconButton
          icon={BarChart3}
          label={project.baselineSavedAt ? (showBaseline ? 'Hide baseline' : 'Show baseline') : 'No baseline saved yet (Settings tab)'}
          active={showBaseline}
          disabled={!project.baselineSavedAt}
          onClick={() => setShowBaseline(!showBaseline)}
        />
        <div className="ml-auto flex items-center gap-2">
          {saving ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /> Saving…
            </span>
          ) : (
            <IconButton icon={RefreshCw} label="Refresh" onClick={() => plan.refetch()} />
          )}
          <button
            type="button"
            onClick={() => exportCsv(project, tasks, resourceNames)}
            disabled={!tasks.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            type="button"
            onClick={() => run(() => exportPdf(project, tasks, resourceNames))}
            disabled={!tasks.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-800 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-40"
          >
            <FileText className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {/* Grid + timeline */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {tasks.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="This plan is empty"
            message={canEdit ? 'Add your first task. Then set durations and link tasks; dates are calculated for you.' : 'No tasks have been added yet.'}
            action={
              canEdit && (
                <Button variant="primary" icon={Plus} onClick={() => addTask(false)}>
                  Add first task
                </Button>
              )
            }
          />
        ) : (
          <div ref={scrollRef} className="relative overflow-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 320 }}>
            <div className="flex w-max min-w-full">
              <div
                className="sticky left-0 z-20 bg-white dark:bg-gray-800 overflow-hidden shrink-0 border-r border-gray-200 dark:border-gray-700"
                style={{ width: effectiveGrid }}
              >
                <TaskGrid
                  rows={rows}
                  byId={byId}
                  resourceNames={resourceNames}
                  selectedId={selectedId}
                  collapsed={collapsed}
                  canEdit={canEdit}
                  today={today}
                  editRequest={editRequest}
                  onSelect={setSelectedId}
                  onOpen={setDrawerId}
                  onToggle={toggle}
                  onCommit={onCommit}
                />
                <div
                  onPointerDown={startResize}
                  className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors"
                  style={{ minHeight: HEADER_H + rows.length * ROW_H }}
                  title="Drag to resize"
                  role="separator"
                  aria-orientation="vertical"
                />
              </div>
              <div className="relative">
                <GanttChart
                  project={project}
                  rows={rows}
                  byId={byId}
                  resourceNames={resourceNames}
                  zoom={zoom}
                  showCritical={showCritical}
                  showBaseline={showBaseline && !!project.baselineSavedAt}
                  selectedId={selectedId}
                  minWidth={Math.max(0, viewport - effectiveGrid)}
                  themeColor={themeColor}
                  isDark={isDark}
                  onSelect={setSelectedId}
                  onOpen={setDrawerId}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <p className={cn('text-xs text-gray-400 dark:text-gray-500 no-print', !canEdit && 'hidden')}>
        Tip: click a row to select it, click a cell again to edit it. Predecessors use row numbers, e.g. <code>3</code>, <code>5SS+2</code>, <code>7FF-1</code>. Double-click a row
        for all details. Drag the divider to show more columns.
      </p>

      <TaskDrawer
        task={drawerId ? byId.get(drawerId) ?? null : null}
        tasks={tasks}
        resources={resources}
        canEdit={canEdit}
        today={today}
        onClose={() => setDrawerId(null)}
        onSave={async (taskId, patch) => {
          await mutations.update.mutateAsync({ taskId, patch });
        }}
        onDelete={deleteTask}
      />
    </div>
  );
}
