'use client';

import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { useViewState } from '@/components/views/useViewState';
import { ViewToolbar } from '@/components/views/ViewToolbar';
import { useWorkspace } from '@/features/project-context';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays, diffDays, monthLabel, parseISO, weekday } from '@/lib/dates';
import { runQuery } from '@/lib/query';
import { useTheme } from '@/lib/theme';
import type { Task } from '@/lib/types';
import { isWorkingDay } from '@/lib/workcal';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LANE_H = 22;

interface Placed {
  task: Task;
  col: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Places task bars into lanes for one week (Mon–Sun) so they don't overlap. */
function layoutWeek(weekStart: string, tasks: Task[]): { placed: Placed[]; lanes: number } {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = tasks
    .filter((t) => t.start && t.start <= weekEnd && t.finish >= weekStart)
    .sort((a, b) => a.start.localeCompare(b.start) || diffDays(b.start, b.finish) - diffDays(a.start, a.finish));
  const laneEnds: number[] = [];
  const placed = inWeek.map((task) => {
    const from = task.start < weekStart ? weekStart : task.start;
    const to = task.finish > weekEnd ? weekEnd : task.finish;
    const col = diffDays(weekStart, from);
    const span = diffDays(from, to) + 1;
    let lane = laneEnds.findIndex((end) => end < col);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = col + span - 1;
    return { task, col, span, lane, continuesBefore: task.start < weekStart, continuesAfter: task.finish > weekEnd };
  });
  return { placed, lanes: laneEnds.length };
}

export default function CalendarPage() {
  const { projectId, plan, tasks, ctx, isLoading, error, openTask } = useWorkspace();
  const viewState = useViewState(projectId, 'calendar');
  const { themeColor } = useTheme();
  const [month, setMonth] = useState<string | null>(null);

  const leaves = useMemo(() => tasks.filter((t) => !t.isSummary), [tasks]);
  const rows = useMemo(() => (ctx ? runQuery(leaves, viewState.config, ctx) : []), [leaves, viewState.config, ctx]);

  if (isLoading) return <PageLoader label="Loading calendar…" />;
  if (error || !ctx || !plan) return <Alert>{errorMessage(error, 'Could not load the calendar')}</Alert>;

  // Default month: this month if the project is running, otherwise the project start month.
  const today = ctx.today;
  const defaultMonth = (today >= plan.project.startDate && today <= plan.project.finishDate ? today : plan.project.startDate).slice(0, 7);
  const current = month ?? defaultMonth;
  const first = `${current}-01`;
  const gridStart = addDays(first, -((weekday(first) + 6) % 7));
  const nextMonth = (delta: number) => {
    const d = new Date(parseISO(first));
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(d.toISOString().slice(0, 7));
  };
  const weeks: string[] = [];
  for (let w = gridStart; w.slice(0, 7) <= current; w = addDays(w, 7)) weeks.push(w);

  return (
    <div className="space-y-3">
      <ViewToolbar kind="calendar" state={viewState}>
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => nextMonth(-1)} />
        <span className="text-sm font-semibold text-gray-900 dark:text-white w-28 text-center">{monthLabel(first)}</span>
        <IconButton icon={ChevronRight} label="Next month" onClick={() => nextMonth(1)} />
        <Button size="sm" onClick={() => setMonth(today.slice(0, 7))}>
          Today
        </Button>
      </ViewToolbar>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto custom-scrollbar">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((weekStart) => {
            const { placed, lanes } = layoutWeek(weekStart, rows);
            return (
              <div key={weekStart} className="relative border-b border-gray-100 dark:border-gray-700" style={{ minHeight: 28 + Math.max(lanes, 2) * LANE_H + 8 }}>
                <div className="absolute inset-0 grid grid-cols-7">
                  {Array.from({ length: 7 }, (_, i) => {
                    const day = addDays(weekStart, i);
                    const outside = day.slice(0, 7) !== current;
                    return (
                      <div
                        key={day}
                        className={cn(
                          'border-r border-gray-100 dark:border-gray-700 last:border-r-0 px-2 py-1',
                          !isWorkingDay(plan.project, day) && 'bg-gray-50 dark:bg-gray-900/40',
                        )}
                      >
                        <span
                          className={cn('inline-flex items-center justify-center text-xs tabular-nums w-6 h-6 rounded-full', outside ? 'text-gray-300 dark:text-gray-600' : 'text-gray-600 dark:text-gray-300', day === today && 'text-white font-semibold')}
                          style={day === today ? { backgroundColor: themeColor } : undefined}
                        >
                          {Number(day.slice(8))}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {placed.map((p) => {
                  const status = p.task.status ? ctx.statuses.get(p.task.status) : undefined;
                  const color = status?.color ?? themeColor;
                  return (
                    <button
                      key={p.task._id}
                      type="button"
                      onClick={() => openTask(p.task._id)}
                      title={`${p.task.name} · ${p.task.start} → ${p.task.finish}${status ? ` · ${status.name}` : ''}`}
                      className={cn(
                        'absolute flex items-center gap-1 px-1.5 text-[11px] font-medium truncate text-left transition-opacity hover:opacity-80',
                        p.continuesBefore ? 'rounded-l-none' : 'rounded-l-md',
                        p.continuesAfter ? 'rounded-r-none' : 'rounded-r-md',
                      )}
                      style={{
                        top: 30 + p.lane * LANE_H,
                        height: LANE_H - 4,
                        left: `calc(${(p.col / 7) * 100}% + 2px)`,
                        width: `calc(${(p.span / 7) * 100}% - 4px)`,
                        backgroundColor: p.task.isMilestone ? 'transparent' : `${color}26`,
                        color,
                        borderLeft: p.task.isMilestone || p.continuesBefore ? undefined : `3px solid ${color}`,
                      }}
                    >
                      {p.task.isMilestone && <Diamond className="w-3 h-3 shrink-0" fill="currentColor" />}
                      <span className="truncate text-gray-800 dark:text-gray-100">{p.task.name}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">Bars are colored by status. Summary tasks are hidden; click a bar for details.</p>
    </div>
  );
}
