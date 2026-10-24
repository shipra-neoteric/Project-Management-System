'use client';

import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Diamond, UserX } from 'lucide-react';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CRITICAL, HATCH, hrs, LoadLegend, useLoadScale } from '@/components/planner/load';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { FilterTabs } from '@/components/ui/Layout';
import { useWorkspace } from '@/features/project-context';
import { usePlanner, useTaskMutations } from '@/features/queries';
import { toastError } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays, diffDays, fmtDate, parseISO, todayISO, weekday } from '@/lib/dates';
import { projectPeople } from '@/lib/permissions';
import type { Task, UserRef } from '@/lib/types';
import { isWorkingDay, nextWorkingDay } from '@/lib/workcal';

type Span = 1 | 2 | 4;
const DAY_W: Record<Span, number> = { 1: 120, 2: 64, 4: 34 };
const NAME_W = 200;
const LANE_H = 26;
const STRIP_H = 16;
const UNASSIGNED = 'unassigned';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const monday = (iso: string) => addDays(iso, -((weekday(iso) + 6) % 7));

interface Placed {
  task: Task;
  col: number;
  span: number;
  lane: number;
}

/** Places a person's bars into lanes so overlapping tasks stack instead of hiding each other. */
function layout(tasks: Task[], from: string, days: number): { placed: Placed[]; lanes: number } {
  const laneEnds: number[] = [];
  const placed = [...tasks]
    .sort((a, b) => a.start.localeCompare(b.start) || b.finish.localeCompare(a.finish))
    .map((task) => {
      const col = Math.max(0, diffDays(from, task.start));
      const end = Math.min(days - 1, diffDays(from, task.finish));
      let lane = laneEnds.findIndex((e) => e < col);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { task, col, span: Math.max(1, end - col + 1), lane };
    });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

interface DragState {
  task: Task;
  row: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  moved: boolean;
}

export default function TeamPlannerPage() {
  const { projectId, plan, tasks, ctx, isLoading, error, openTask, canEdit } = useWorkspace();
  const mutations = useTaskMutations(projectId);
  const { cell } = useLoadScale();
  const [span, setSpan] = useState<Span>(2);
  const [from, setFrom] = useState(() => monday(todayISO()));
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const days = span * 7;
  const to = addDays(from, days - 1);
  const dayW = DAY_W[span];
  const load = usePlanner(from, to, projectId);
  const today = todayISO();

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);

  const people = useMemo(() => {
    if (!plan) return [] as UserRef[];
    return [...projectPeople(plan.project).values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [plan]);

  /** Leaf tasks overlapping the range, by assignee (or "unassigned"). */
  const byRow = useMemo(() => {
    const map = new Map<string, Task[]>();
    const ids = new Set(people.map((p) => p._id));
    for (const t of tasks) {
      if (t.isSummary || t.start > to || t.finish < from) continue;
      const row = t.assignee && ids.has(t.assignee) ? t.assignee : UNASSIGNED;
      map.set(row, [...(map.get(row) ?? []), t]);
    }
    return map;
  }, [tasks, people, from, to]);

  if (isLoading) return <PageLoader label="Loading team planner…" />;
  if (error || !ctx || !plan) return <Alert>{errorMessage(error, 'Could not load the team planner')}</Alert>;
  const project = plan.project;

  const colorOf = (t: Task) => (t.status && ctx.statuses.get(t.status)?.color) || (t.type && ctx.types.get(t.type)?.color) || '#6b7280';
  const statusName = (t: Task) => (t.status ? ctx.statuses.get(t.status)?.name : '') ?? '';

  // ---- Drag: horizontal = move (whole days), vertical = reassign ---------------------------------

  const onPointerDown = (e: ReactPointerEvent, task: Task, row: string) => {
    if (e.button !== 0) return;
    const state = { task, row, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    dragRef.current = state;
    setDrag(state);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || !canEdit) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const next = { ...d, dx, dy, moved: d.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4 };
    dragRef.current = next;
    setDrag(next);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved || !canEdit) return openTask(d.task._id);

    const shiftDays = Math.round(d.dx / dayW);
    // The pointer is captured by the bar, so look underneath it for the row it was dropped on.
    const target = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((el) => (el as HTMLElement).closest?.('[data-row]') as HTMLElement | null)
      .find(Boolean)
      ?.getAttribute('data-row');
    const row = target ?? d.row;

    const patch: { constraintStart?: string; assignee?: string | null } = {};
    if (shiftDays !== 0) patch.constraintStart = nextWorkingDay(project, addDays(d.task.start, shiftDays));
    if (row !== d.row) patch.assignee = row === UNASSIGNED ? null : row;
    if (!Object.keys(patch).length) return;
    mutations.update.mutateAsync({ taskId: d.task._id, patch }).catch((err) => void toastError(errorMessage(err, 'The change could not be saved')));
  };

  const shift = (dir: 1 | -1) => setFrom((f) => addDays(f, dir * days));
  const rows: { id: string; person: UserRef | null }[] = [...people.map((p) => ({ id: p._id, person: p })), { id: UNASSIGNED, person: null }];
  const gridW = days * dayW;

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2">
        <FilterTabs<'1' | '2' | '4'>
          value={String(span) as '1' | '2' | '4'}
          onChange={(v) => setSpan(Number(v) as Span)}
          tabs={[
            { key: '1', label: '1 week' },
            { key: '2', label: '2 weeks' },
            { key: '4', label: '4 weeks' },
          ]}
        />
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Earlier" onClick={() => shift(-1)} />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap px-1">
            {fmtDate(from)} – {fmtDate(to)}
          </span>
          <IconButton icon={ChevronRight} label="Later" onClick={() => shift(1)} />
          <Button size="sm" onClick={() => setFrom(monday(todayISO()))}>
            Today
          </Button>
        </div>
        <p className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          {canEdit ? 'Drag a task sideways to move it, or onto another person to reassign it.' : 'Read-only: you can’t edit tasks in this project.'}
        </p>
      </div>

      <LoadLegend />
      {load.error && <Alert tone="warning">{errorMessage(load.error, 'Could not load workloads')}</Alert>}

      {people.length === 0 && !byRow.get(UNASSIGNED)?.length ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <EmptyState icon={CalendarRange} title="Nothing to plan yet" message="Add members under Settings & team, then assign tasks to them." />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto custom-scrollbar select-none">
          <div style={{ width: NAME_W + gridW }} className="min-w-full">
            {/* Header: weeks and days */}
            <div className="flex sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <div
                className="sticky left-0 z-30 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r border-gray-200 dark:border-gray-700 flex items-end"
                style={{ width: NAME_W, minWidth: NAME_W }}
              >
                Person
              </div>
              {dates.map((d) => {
                const date = new Date(parseISO(d));
                const isToday = d === today;
                return (
                  <div
                    key={d}
                    className={cn(
                      'text-center py-1.5 border-r border-gray-100 dark:border-gray-700 text-[11px]',
                      !isWorkingDay(project, d) ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300',
                    )}
                    style={{ width: dayW, minWidth: dayW }}
                  >
                    <div className={cn('uppercase text-[10px]', isToday && 'theme-text font-bold')}>{span === 4 ? DAY_NAMES[date.getUTCDay()][0] : DAY_NAMES[date.getUTCDay()]}</div>
                    <div className={cn('tabular-nums', isToday && 'theme-text font-bold')}>
                      {date.getUTCDate()}
                      {span === 1 && ` ${MONTHS[date.getUTCMonth()]}`}
                    </div>
                  </div>
                );
              })}
            </div>

            {rows.map(({ id, person }) => {
              const { placed, lanes } = layout(byRow.get(id) ?? [], from, days);
              const cap = person ? load.data?.capacity[person._id] : undefined;
              const alloc = person ? load.data?.allocation[person._id] : undefined;
              const off = person ? (load.data?.timeOff ?? []).filter((t) => String(t.user) === person._id) : [];
              const over = !!cap && !!alloc && alloc.some((a, i) => a > (cap[i] ?? 0) + 0.01);
              const isDropTarget = drag?.moved && canEdit && rowUnderDrag(drag) === id;
              const height = lanes * LANE_H + 10 + (person ? STRIP_H + 4 : 0);
              return (
                <div key={id} data-row={id} className={cn('flex border-b border-gray-100 dark:border-gray-700', isDropTarget && 'bg-blue-50/60 dark:bg-blue-900/20')}>
                  <div
                    className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-3 py-2 border-r border-gray-200 dark:border-gray-700 flex items-start gap-2"
                    style={{ width: NAME_W, minWidth: NAME_W, minHeight: height }}
                  >
                    {person ? (
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                          {person.name}
                          {over && <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: CRITICAL }} aria-label="Over-allocated" />}
                        </p>
                        {person.kind === 'placeholder' && <Badge tone="warning">Placeholder</Badge>}
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                        <UserX className="w-4 h-4" /> Unassigned
                      </p>
                    )}
                  </div>
                  <div className="relative" style={{ width: gridW, height }}>
                    {/* Day backdrop: non-working days and today */}
                    <div className="absolute inset-0 flex">
                      {dates.map((d) => (
                        <div
                          key={d}
                          className={cn(
                            'h-full border-r border-gray-100 dark:border-gray-700/60',
                            !isWorkingDay(project, d) && 'bg-gray-50 dark:bg-gray-900/40',
                            d === today && 'bg-amber-50/50 dark:bg-amber-900/10',
                          )}
                          style={{ width: dayW, minWidth: dayW, ...(off.some((t) => d >= t.start && d <= t.end) ? HATCH : {}) }}
                        />
                      ))}
                    </div>

                    {placed.map(({ task, col, span: w, lane }) => {
                      const dragging = drag?.task._id === task._id && drag.moved && canEdit;
                      const color = colorOf(task);
                      const continuesBefore = task.start < from;
                      const continuesAfter = task.finish > to;
                      const snapped = dragging ? Math.round(drag.dx / dayW) * dayW : 0;
                      return (
                        <div
                          key={task._id}
                          role="button"
                          tabIndex={0}
                          title={`${task.name}\n${fmtDate(task.start)} → ${fmtDate(task.finish)}${statusName(task) ? ` · ${statusName(task)}` : ''}${task.work ? ` · ${hrs(task.work)} h work` : ''}`}
                          onPointerDown={(e) => onPointerDown(e, task, id)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          onPointerCancel={() => {
                            dragRef.current = null;
                            setDrag(null);
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && openTask(task._id)}
                          className={cn(
                            'absolute flex items-center gap-1 px-2 text-[11px] font-medium text-white overflow-hidden whitespace-nowrap shadow-sm',
                            canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                            continuesBefore ? 'rounded-l-none' : 'rounded-l',
                            continuesAfter ? 'rounded-r-none' : 'rounded-r',
                            dragging && 'z-30 opacity-90 ring-2 ring-white dark:ring-gray-900 shadow-lg',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                          )}
                          style={{
                            left: col * dayW + 2,
                            width: w * dayW - 4,
                            top: 5 + lane * LANE_H,
                            height: LANE_H - 4,
                            backgroundColor: color,
                            transform: dragging ? `translate(${snapped}px, ${drag.dy}px)` : undefined,
                          }}
                        >
                          {task.isMilestone && <Diamond className="w-3 h-3 shrink-0" />}
                          {task.number ? <span className="opacity-80 font-mono">{project.key}-{task.number}</span> : null}
                          <span className="truncate">{task.name}</span>
                        </div>
                      );
                    })}

                    {/* Daily load from the resource planner (all projects) */}
                    {person && (
                      <div className="absolute left-0 right-0 flex" style={{ bottom: 3, height: STRIP_H }}>
                        {dates.map((d, i) => {
                          const a = alloc?.[i] ?? 0;
                          const k = cap?.[i] ?? 0;
                          const isOff = off.some((t) => d >= t.start && d <= t.end);
                          const v = cell(a, k, isOff);
                          return (
                            <div key={d} className="px-[1px]" style={{ width: dayW, minWidth: dayW }}>
                              <div
                                title={`${person.name} · ${fmtDate(d)}: ${hrs(a)} h booked of ${hrs(k)} h (all projects)`}
                                className={cn(
                                  'h-full rounded-[3px] text-[10px] leading-4 text-center tabular-nums font-medium',
                                  v.state === 'empty' && 'text-gray-300 dark:text-gray-600',
                                )}
                                style={v.bg ? { backgroundColor: v.bg, color: v.fg } : undefined}
                              >
                                {a > 0 && dayW >= 34 ? hrs(a) : ''}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Row id under the dragged bar's pointer position (for the drop highlight). */
function rowUnderDrag(d: DragState): string | null {
  if (typeof document === 'undefined') return null;
  for (const el of document.elementsFromPoint(d.x + d.dx, d.y + d.dy)) {
    const row = (el as HTMLElement).closest?.('[data-row]');
    if (row) return row.getAttribute('data-row');
  }
  return null;
}
