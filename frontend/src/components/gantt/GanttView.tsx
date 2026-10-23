'use client';

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Diamond,
  Download,
  FileText,
  Flag,
  GanttChartSquare,
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
import { BulkBar } from '@/components/views/BulkBar';
import { useViewState } from '@/components/views/useViewState';
import { ViewToolbar } from '@/components/views/ViewToolbar';
import { useWorkspace } from '@/features/project-context';
import { keys, useBaselines, useBaselineSnapshot, useTaskMutations, type TaskPatch } from '@/features/queries';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { confirmDanger, toastError } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays } from '@/lib/dates';
import { exportCsv, exportGanttPdf, exportPdf } from '@/lib/export';
import { filterHierarchy } from '@/lib/query';
import { useTheme } from '@/lib/theme';
import type { Task } from '@/lib/types';
import { nextWorkingDay, workingDaysBetween } from '@/lib/workcal';
import { GanttChart, HEADER_H, ROW_H, type Zoom } from './GanttChart';
import { parsePredecessors } from './predecessors';
import { GRID_DEFAULT_WIDTH, GRID_FULL_WIDTH, TaskGrid, type EditableField } from './TaskGrid';

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

export function GanttView() {
  const { projectId, plan, tasks, byId, resources, ctx, canEdit, isLoading, error, refetch, openTask } = useWorkspace();
  const mutations = useTaskMutations(projectId);
  const saving = useIsMutating({ mutationKey: keys.plan(projectId) }) > 0;
  const { themeColor, isDark } = useTheme();
  const viewState = useViewState(projectId, 'gantt');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lastChecked = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editRequest, setEditRequest] = useState<{ taskId: string; field: EditableField; nonce: number } | null>(null);
  const [zoom, setZoom] = usePersistentState<Zoom>('pms_gantt_zoom', 'day');
  const [showCritical, setShowCritical] = usePersistentState('pms_gantt_critical', false);
  const [showBaseline, setShowBaseline] = usePersistentState('pms_gantt_baseline', false);
  const [gridWidth, setGridWidth] = usePersistentState<number | null>('pms_gantt_grid_width', null);
  const [baselineId, setBaselineId] = useState('');
  const baselines = useBaselines(projectId);
  const snapshot = useBaselineSnapshot(projectId, baselineId || null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(1000);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientWidth));
    ro.observe(el);
    setViewport(el.clientWidth);
    return () => ro.disconnect();
  }, [plan, tasks.length]);

  const project = plan?.project;
  const resourceNames = useMemo(() => new Map(resources.map((r) => [r._id, r.name])), [resources]);

  // Filter (keeping ancestors for context), then hide children of collapsed summaries.
  const { rows, matched } = useMemo(() => {
    if (!ctx) return { rows: tasks, matched: undefined };
    const filtered = filterHierarchy(tasks, viewState.config, ctx);
    const hidden = new Set<string>();
    const visible = filtered.rows.filter((t) => {
      if (t.parent && (hidden.has(t.parent) || collapsed.has(t.parent))) {
        hidden.add(t._id);
        return false;
      }
      return true;
    });
    const isFiltered = filtered.matched.size !== tasks.length;
    return { rows: visible, matched: isFiltered ? filtered.matched : undefined };
  }, [tasks, ctx, viewState.config, collapsed]);

  // Compare against an older saved baseline instead of the latest one.
  const chartRows = useMemo(() => {
    if (!baselineId || !snapshot.data) return rows;
    const map = new Map(snapshot.data.tasks.map((b) => [b.task, b]));
    return rows.map((t) => ({ ...t, baselineStart: map.get(t._id)?.start ?? null, baselineFinish: map.get(t._id)?.finish ?? null }));
  }, [rows, baselineId, snapshot.data]);

  // Drop selections of tasks that no longer exist.
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => byId.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [byId]);

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

  const deleteTask = async (task: Task) => {
    const children = tasks.filter((t) => t.wbs.startsWith(`${task.wbs}.`)).length;
    const ok = await confirmDanger(`Delete "${task.name}"?`, children ? `Its ${children} sub-task${children === 1 ? '' : 's'} will be deleted too.` : 'Links to this task will be removed.');
    if (!ok) return;
    await run(() => mutations.remove.mutateAsync(task._id));
    setSelectedId(null);
  };

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

  /** Dragging a bar sets its start (Start-No-Earlier-Than, or the fixed date when manual); dragging its end sets the duration. */
  const onBarDrag = useCallback(
    (task: Task, mode: 'move' | 'resize', days: number) => {
      if (!project) return;
      if (mode === 'move') {
        const start = nextWorkingDay(project, addDays(task.start, days));
        void run(() => mutations.update.mutateAsync({ taskId: task._id, patch: { constraintStart: start } }));
      } else {
        const finish = addDays(task.finish, days);
        const duration = Math.max(1, workingDaysBetween(project, task.start, finish));
        if (duration !== task.duration) void run(() => mutations.update.mutateAsync({ taskId: task._id, patch: { duration } }));
      }
    },
    [project, mutations.update, run],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onCheck = useCallback(
    (id: string, range: boolean) => {
      setChecked((prev) => {
        const next = new Set(prev);
        const anchor = lastChecked.current;
        if (range && anchor) {
          const a = rows.findIndex((t) => t._id === anchor);
          const b = rows.findIndex((t) => t._id === id);
          if (a >= 0 && b >= 0) {
            for (const t of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(t._id);
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        lastChecked.current = id;
        return next;
      });
    },
    [rows],
  );

  const onCheckAll = useCallback(() => {
    setChecked((prev) => (rows.every((t) => prev.has(t._id)) ? new Set() : new Set(rows.map((t) => t._id))));
  }, [rows]);

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

  if (isLoading) return <PageLoader label="Loading plan…" />;
  if (error || !project || !ctx) return <Alert>{errorMessage(error, 'Could not load the plan')}</Alert>;

  return (
    <div className="space-y-3">
      <ViewToolbar kind="gantt" state={viewState} />

      {/* Action toolbar */}
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
        {showBaseline && (baselines.data?.length ?? 0) > 1 && (
          <div className="w-48">
            <ThemedSelect
              compact
              options={[{ value: '', label: 'Latest baseline' }, ...(baselines.data ?? []).map((b) => ({ value: b._id, label: b.name, description: `Finish ${b.finishDate}` }))]}
              value={baselineId}
              onChange={setBaselineId}
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {saving ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /> Saving…
            </span>
          ) : (
            <IconButton icon={RefreshCw} label="Refresh" onClick={refetch} />
          )}
          <ExportButton tone="green" icon={Download} label="Excel" disabled={!rows.length} onClick={() => exportCsv(project, rows, resourceNames)} />
          <ExportButton tone="red" icon={FileText} label="PDF" disabled={!rows.length} onClick={() => run(() => exportPdf(project, rows, resourceNames))} />
          <ExportButton
            tone="red"
            icon={GanttChartSquare}
            label="Gantt PDF"
            disabled={!rows.length}
            onClick={() => run(() => exportGanttPdf(project, chartRows, { showCritical, showBaseline: showBaseline && !!project.baselineSavedAt }))}
          />
        </div>
      </div>

      <BulkBar selected={[...checked]} onClear={() => setChecked(new Set())} />

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
        ) : rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="No tasks match the current filters" message="Adjust or clear the filters in View options." />
        ) : (
          <div ref={scrollRef} className="relative overflow-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 380px)', minHeight: 320 }}>
            <div className="flex w-max min-w-full">
              <div className="sticky left-0 z-20 bg-white dark:bg-gray-800 overflow-hidden shrink-0 border-r border-gray-200 dark:border-gray-700" style={{ width: effectiveGrid }}>
                <TaskGrid
                  rows={rows}
                  byId={byId}
                  resourceNames={resourceNames}
                  selectedId={selectedId}
                  collapsed={collapsed}
                  canEdit={canEdit}
                  today={ctx.today}
                  editRequest={editRequest}
                  onSelect={setSelectedId}
                  onOpen={openTask}
                  onToggle={toggle}
                  onCommit={onCommit}
                  ctx={ctx}
                  checked={checked}
                  onCheck={onCheck}
                  onCheckAll={onCheckAll}
                  matched={matched}
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
              <GanttChart
                project={project}
                rows={chartRows}
                byId={byId}
                resourceNames={resourceNames}
                zoom={zoom}
                showCritical={showCritical}
                showBaseline={showBaseline && !!project.baselineSavedAt}
                selectedId={selectedId}
                minWidth={Math.max(0, viewport - effectiveGrid)}
                themeColor={themeColor}
                isDark={isDark}
                matched={matched}
                canEdit={canEdit}
                onSelect={setSelectedId}
                onOpen={openTask}
                onBarDrag={onBarDrag}
              />
            </div>
          </div>
        )}
      </div>

      <p className={cn('text-xs text-gray-400 dark:text-gray-500 no-print', !canEdit && 'hidden')}>
        Tip: drag a bar to move it, drag its right edge to change the duration. Tick rows for bulk actions (Shift-click selects a range). Predecessors use row numbers, e.g. <code>3</code>,{' '}
        <code>5SS+2</code>. Double-click a row for all details.
      </p>
    </div>
  );
}

function ExportButton({ tone, icon: Icon, label, disabled, onClick }: { tone: 'green' | 'red'; icon: typeof Download; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border rounded-md transition-colors disabled:opacity-40',
        tone === 'green'
          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30'
          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30',
      )}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}
