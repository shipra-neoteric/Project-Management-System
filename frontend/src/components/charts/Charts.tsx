'use client';

import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { diffDays, fmtDate } from '@/lib/dates';
import { useTheme } from '@/lib/theme';

/*
 * Small inline-SVG/HTML charts following the dataviz rules:
 * part-to-whole = one stacked bar (not a donut) with a 2px surface gap between segments and a
 * legend that always shows name + count + share (so colour is never the only channel);
 * magnitude = single-hue horizontal bars, <= 12px thick, 4px rounded data end, value in text ink.
 */

export interface Segment {
  key: string;
  label: string;
  color: string;
  count: number;
}

/** Part-to-whole: one horizontal stacked bar + legend/table. */
export function StackedShare({ segments, emptyText = 'No data yet' }: { segments: Segment[]; emptyText?: string }) {
  const total = segments.reduce((a, s) => a + s.count, 0);
  const visible = segments.filter((s) => s.count > 0);
  if (!total) return <p className="text-sm text-gray-400 dark:text-gray-500">{emptyText}</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full gap-0.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700" role="img" aria-label={visible.map((s) => `${s.label} ${s.count}`).join(', ')}>
        {visible.map((s) => (
          <div key={s.key} className="h-full first:rounded-l-full last:rounded-r-full transition-all" style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${s.count} (${Math.round((s.count / total) * 100)}%)`} />
        ))}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className={cn('flex items-center gap-2 text-sm', s.count === 0 && 'opacity-50')}>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="text-gray-700 dark:text-gray-200 truncate">{s.label}</span>
            <span className="ml-auto text-gray-900 dark:text-white font-medium tabular-nums">{s.count}</span>
            <span className="w-10 text-right text-xs text-gray-400 tabular-nums">{Math.round((s.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
}

/** Magnitude comparison: sorted single-hue horizontal bars with the value at the bar end. */
export function BarList({ rows, max = 8, emptyText = 'No data yet', unit = '' }: { rows: BarRow[]; max?: number; emptyText?: string; unit?: string }) {
  const { themeColor } = useTheme();
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((a, r) => a + r.value, 0);
  if (rest > 0) shown.push({ key: '__other', label: `Other (${sorted.length - max})`, value: rest });
  const top = Math.max(1, ...shown.map((r) => r.value));
  if (!shown.length) return <p className="text-sm text-gray-400 dark:text-gray-500">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {shown.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3" title={`${r.label}: ${r.value}${unit}`}>
          <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{r.label}</span>
          <span className="h-3 rounded-r bg-transparent">
            <span className="block h-3 rounded-r" style={{ width: `${Math.max(2, (r.value / top) * 100)}%`, backgroundColor: r.key === '__other' ? 'rgb(156 163 175)' : themeColor }} />
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums w-8 text-right">
            {r.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface PhaseBar {
  key: string;
  name: string;
  color: string;
  start: string | null;
  finish: string | null;
  gate: string;
  gateStatus: 'pending' | 'passed' | 'failed';
}

const GATE = {
  passed: { icon: CheckCircle2, cls: 'text-green-600 dark:text-green-400', label: 'Passed' },
  failed: { icon: XCircle, cls: 'text-red-600 dark:text-red-400', label: 'Failed' },
  pending: { icon: Circle, cls: 'text-gray-400', label: 'Pending' },
};

/** Project life-cycle: phases on a shared time axis, each gate shown with an icon + label. */
export function LifecycleStrip({ phases, today }: { phases: PhaseBar[]; today: string }) {
  const dated = phases.filter((p) => p.start && p.finish);
  if (!phases.length) return <p className="text-sm text-gray-400 dark:text-gray-500">No life-cycle phases defined for this project.</p>;
  const min = dated.length ? dated.map((p) => p.start!).sort()[0] : today;
  const max = dated.length ? dated.map((p) => p.finish!).sort().reverse()[0] : today;
  const span = Math.max(1, diffDays(min, max) + 1);
  const pos = (d: string) => (diffDays(min, d) / span) * 100;
  const todayIn = today >= min && today <= max;

  return (
    <div className="space-y-2">
      {phases.map((p) => {
        const gate = GATE[p.gateStatus];
        const Icon = gate.icon;
        const current = p.start && p.finish && today >= p.start && today <= p.finish;
        return (
          <div key={p.key} className="grid grid-cols-[minmax(0,8rem)_1fr_minmax(0,10rem)] items-center gap-3">
            <span className={cn('text-sm truncate', current ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200')}>{p.name}</span>
            <span className="relative h-5">
              <span className="absolute inset-y-[9px] left-0 right-0 h-px bg-gray-200 dark:bg-gray-700" />
              {p.start && p.finish ? (
                <span
                  className="absolute top-1 h-3 rounded"
                  style={{ left: `${pos(p.start)}%`, width: `${Math.max(1.5, ((diffDays(p.start, p.finish) + 1) / span) * 100)}%`, backgroundColor: p.color }}
                  title={`${p.name}: ${fmtDate(p.start)} → ${fmtDate(p.finish)}`}
                />
              ) : (
                <span className="absolute inset-0 text-[11px] text-gray-400 flex items-center">Dates not set</span>
              )}
              {todayIn && <span className="absolute top-0 bottom-0 w-0.5 bg-red-500/70" style={{ left: `${pos(today)}%` }} title="Today" />}
            </span>
            <span className={cn('flex items-center gap-1 text-xs min-w-0', gate.cls)} title={p.gate ? `${p.gate}: ${gate.label}` : undefined}>
              {p.gate ? (
                <>
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{p.gate}</span>
                </>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </span>
          </div>
        );
      })}
      {dated.length > 0 && (
        <div className="grid grid-cols-[minmax(0,8rem)_1fr_minmax(0,10rem)] gap-3 text-[11px] text-gray-400">
          <span />
          <span className="flex justify-between">
            <span>{fmtDate(min)}</span>
            <span>{fmtDate(max)}</span>
          </span>
          <span />
        </div>
      )}
    </div>
  );
}
