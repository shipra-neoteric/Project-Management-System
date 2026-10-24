'use client';

import { AlertTriangle, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, Gauge, Users } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { HATCH, hrs, LoadLegend, useLoadScale } from '@/components/planner/load';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { FilterTabs, KpiCard, KpiGrid, Page, PageHeader, SearchInput } from '@/components/ui/Layout';
import { usePlanner } from '@/features/queries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays, fmtDate, parseISO, todayISO, weekday } from '@/lib/dates';
import { exportFileName, exportXlsx } from '@/lib/export';
import type { Planner } from '@/lib/types';

type Preset = '2w' | 'month' | 'quarter';
const SPAN: Record<Preset, number> = { '2w': 14, month: 28, quarter: 91 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const monday = (iso: string) => addDays(iso, -((weekday(iso) + 6) % 7));
const dayMonth = (iso: string) => {
  const d = new Date(parseISO(iso));
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
};

/** A column of the grid: one day, or one week (Mon–Sun) for long ranges. */
interface Column {
  key: string;
  label: string;
  sub: string;
  /** Indexes into planner.days */
  idx: number[];
  weekend: boolean;
}

function buildColumns(days: string[], byWeek: boolean): Column[] {
  if (!byWeek) {
    return days.map((d, i) => ({ key: d, label: DAY_NAMES[weekday(d)], sub: d.slice(8), idx: [i], weekend: weekday(d) === 0 || weekday(d) === 6 }));
  }
  const cols: Column[] = [];
  days.forEach((d, i) => {
    const wk = monday(d);
    const last = cols[cols.length - 1];
    if (last?.key === wk) last.idx.push(i);
    else cols.push({ key: wk, label: 'Week', sub: dayMonth(wk), idx: [i], weekend: false });
  });
  return cols;
}

const sum = (values: number[], idx: number[]) => idx.reduce((a, i) => a + (values[i] ?? 0), 0);

export default function ResourcePlannerPage() {
  const [preset, setPreset] = useState<Preset>('2w');
  const [from, setFrom] = useState(() => monday(todayISO()));
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const span = SPAN[preset];
  const to = addDays(from, span - 1);
  const { data, isLoading, error } = usePlanner(from, to);
  const { cell } = useLoadScale();

  const byWeek = span > 31;
  const columns = useMemo(() => buildColumns(data?.days ?? [], byWeek), [data?.days, byWeek]);
  const today = todayISO();

  /** Days each person is off, as a set of indexes into planner.days. */
  const offDays = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!data) return map;
    for (const t of data.timeOff) {
      const set = map.get(String(t.user)) ?? new Set<number>();
      data.days.forEach((d, i) => d >= t.start && d <= t.end && set.add(i));
      map.set(String(t.user), set);
    }
    return map;
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return { capacity: 0, allocation: 0, over: new Set<string>() };
    let capacity = 0;
    let allocation = 0;
    const over = new Set<string>();
    for (const u of data.users) {
      const cap = data.capacity[u._id] ?? [];
      const alloc = data.allocation[u._id] ?? [];
      cap.forEach((c, i) => {
        capacity += c;
        allocation += alloc[i] ?? 0;
        if ((alloc[i] ?? 0) > c + 0.01) over.add(u._id);
      });
    }
    return { capacity, allocation, over };
  }, [data]);

  const users = (data?.users ?? []).filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()));

  const shift = (dir: 1 | -1) => setFrom((f) => addDays(f, dir * (byWeek ? span : preset === 'month' ? 28 : 7)));
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Page>
      <PageHeader
        title="Resource planner"
        subtitle="Who is booked when, across every project you can see. Load comes from assigned tasks’ work (or a full day per task day when there is no estimate)."
        actions={
          <Button icon={Download} disabled={!data?.users.length} onClick={() => data && void exportPlanner(data, columns)}>
            Excel
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="People" value={data?.users.length ?? '—'} icon={Users} iconColor="text-blue-500" />
        <KpiCard label="Over-allocated" value={data ? stats.over.size : '—'} icon={AlertTriangle} iconColor="text-red-500" />
        <KpiCard label="Capacity (h)" value={data ? hrs(stats.capacity) : '—'} icon={Clock} iconColor="text-green-500" />
        <KpiCard
          label="Booked (h)"
          value={data ? `${hrs(stats.allocation)}${stats.capacity ? ` · ${Math.round((stats.allocation / stats.capacity) * 100)}%` : ''}` : '—'}
          icon={Gauge}
          iconColor="text-amber-500"
        />
      </KpiGrid>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2">
        <FilterTabs<Preset>
          value={preset}
          onChange={(p) => {
            setPreset(p);
            setFrom(monday(todayISO()));
          }}
          tabs={[
            { key: '2w', label: '2 weeks' },
            { key: 'month', label: '4 weeks' },
            { key: 'quarter', label: 'Quarter' },
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
        <div className="ml-auto">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter people…" />
        </div>
      </div>

      <LoadLegend />

      {error && <Alert>{errorMessage(error, 'Could not load the planner')}</Alert>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <PageLoader label="Calculating capacity…" />
        ) : !users.length ? (
          <EmptyState
            icon={CalendarRange}
            title={data?.users.length ? 'Nobody matches the filter' : 'No people to plan'}
            message={data?.users.length ? undefined : 'People appear here once they are members of an active project.'}
          />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="border-separate border-spacing-0 text-xs w-max min-w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900">
                  <th className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-900 text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-52 border-b border-gray-200 dark:border-gray-700">
                    Person
                  </th>
                  {columns.map((c) => {
                    const isToday = c.idx.some((i) => data!.days[i] === today);
                    return (
                      <th
                        key={c.key}
                        className={cn(
                          'px-0.5 py-1.5 font-medium text-center border-b border-gray-200 dark:border-gray-700',
                          byWeek ? 'min-w-16' : 'min-w-11',
                          c.weekend ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300',
                        )}
                      >
                        <div className={cn('text-[10px] uppercase', isToday && 'theme-text font-bold')}>{c.label}</div>
                        <div className={cn('tabular-nums', isToday && 'theme-text font-bold')}>{c.sub}</div>
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 font-medium text-right text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 whitespace-nowrap">
                    Booked / capacity
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const cap = data!.capacity[u._id] ?? [];
                  const alloc = data!.allocation[u._id] ?? [];
                  const off = offDays.get(u._id) ?? new Set<number>();
                  const totalCap = cap.reduce((a, b) => a + b, 0);
                  const totalAlloc = alloc.reduce((a, b) => a + b, 0);
                  const tasks = data!.tasks.filter((t) => t.assignee === u._id);
                  const open = expanded.has(u._id);
                  return (
                    <Fragment key={u._id}>
                      <tr className="group">
                        <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
                          <button
                            type="button"
                            onClick={() => toggle(u._id)}
                            aria-expanded={open}
                            className="flex items-center gap-2 text-left text-sm text-gray-900 dark:text-white font-medium w-full"
                          >
                            <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform shrink-0', !open && '-rotate-90')} />
                            <span className="truncate">{u.name}</span>
                            {u.kind === 'placeholder' && <Badge tone="warning">Placeholder</Badge>}
                            {stats.over.has(u._id) && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" aria-label="Over-allocated" />}
                          </button>
                        </td>
                        {columns.map((c) => {
                          const a = sum(alloc, c.idx);
                          const k = sum(cap, c.idx);
                          const isOff = c.idx.every((i) => off.has(i) || cap[i] === 0) && c.idx.some((i) => off.has(i));
                          const v = cell(a, k, isOff);
                          return (
                            <td key={c.key} className="p-[1px] border-b border-gray-100 dark:border-gray-700">
                              <div
                                title={`${u.name} · ${byWeek ? `week of ${fmtDate(c.key)}` : fmtDate(c.key)}: ${hrs(a)} h booked of ${hrs(k)} h${isOff ? ' (time off)' : ''}`}
                                className={cn(
                                  'h-8 rounded-[3px] flex items-center justify-center gap-0.5 tabular-nums text-[11px] font-medium',
                                  v.state === 'nonworking' && 'bg-gray-100 dark:bg-gray-700/60 text-gray-400',
                                  v.state === 'empty' && 'text-gray-300 dark:text-gray-600',
                                  v.state === 'off' && 'text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
                                )}
                                style={v.bg ? { backgroundColor: v.bg, color: v.fg } : v.state === 'off' ? HATCH : undefined}
                              >
                                {v.state === 'over' && <AlertTriangle className="w-3 h-3" aria-hidden />}
                                {v.state === 'off' ? 'Off' : a > 0 ? hrs(a) : v.state === 'empty' ? '·' : ''}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap border-b border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                          {hrs(totalAlloc)} / {hrs(totalCap)} h
                          {totalCap > 0 && <span className="ml-1.5 text-gray-400 dark:text-gray-500">{Math.round((totalAlloc / totalCap) * 100)}%</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={columns.length + 2} className="bg-gray-50/60 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700 px-3 py-2">
                            {tasks.length === 0 ? (
                              <p className="text-sm text-gray-400 dark:text-gray-500 pl-6">No open tasks assigned in this period.</p>
                            ) : (
                              <ul className="space-y-1 pl-6 sticky left-0 max-w-[calc(100vw-4rem)]">
                                {tasks.map((t) => (
                                  <li key={t._id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                                    <Link href={`/projects/${t.project}?task=${t._id}`} className="font-medium text-gray-800 dark:text-gray-100 hover:underline">
                                      {t.number ? <span className="font-mono text-xs theme-text mr-1.5">{t.projectKey}-{t.number}</span> : null}
                                      {t.name}
                                    </Link>
                                    <span className="text-gray-500 dark:text-gray-400">{t.projectName}</span>
                                    <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                                      {fmtDate(t.start)} → {fmtDate(t.finish)}
                                    </span>
                                    <span className="text-gray-700 dark:text-gray-200 tabular-nums">{hrs(t.hoursPerDay)} h/day</span>
                                  </li>
                                ))}
                              </ul>
                            )}
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
      </div>
    </Page>
  );
}

/** Booked hours, capacity and the tasks behind them as an Excel workbook. */
function exportPlanner(data: Planner, columns: Column[]) {
  const header = ['Person', ...columns.map((c) => (c.label === 'Week' ? `Week ${c.sub}` : `${c.label} ${c.key}`)), 'Total'];
  const sheet = (name: string, source: Record<string, number[]>) => ({
    name,
    header,
    widths: [26, ...columns.map(() => 11), 10],
    rows: data.users.map((u) => {
      const values = source[u._id] ?? [];
      const cells = columns.map((c) => Math.round(sum(values, c.idx) * 100) / 100);
      return [u.name, ...cells, Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100];
    }),
  });
  const names = new Map(data.users.map((u) => [u._id, u.name]));
  return exportXlsx(exportFileName(`Resource plan ${data.from} to ${data.to}`, 'xlsx'), [
    sheet('Booked hours', data.allocation),
    sheet('Capacity', data.capacity),
    {
      name: 'Tasks',
      header: ['Person', 'Project', 'Task', 'Start', 'Finish', 'Hours per day'],
      widths: [24, 28, 40, 12, 12, 12],
      rows: data.tasks.map((t) => [names.get(t.assignee) ?? '', t.projectName, t.number ? `${t.projectKey}-${t.number} ${t.name}` : t.name, t.start, t.finish, t.hoursPerDay]),
    },
  ]);
}
