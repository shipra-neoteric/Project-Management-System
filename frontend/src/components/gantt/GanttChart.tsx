'use client';

import { memo, useMemo, useRef, useState } from 'react';
import { addDays, diffDays, fmtDate, monthLabel, parseISO, todayISO, weekday } from '@/lib/dates';
import type { Project, Task } from '@/lib/types';

export const ROW_H = 36;
export const HEADER_H = 48;

export type Zoom = 'day' | 'week' | 'month';
export const DAY_WIDTH: Record<Zoom, number> = { day: 28, week: 12, month: 4 };

interface GanttChartProps {
  project: Project;
  rows: Task[];
  byId: Map<string, Task>;
  resourceNames: Map<string, string>;
  zoom: Zoom;
  showCritical: boolean;
  showBaseline: boolean;
  selectedId: string | null;
  minWidth: number;
  themeColor: string;
  isDark: boolean;
  /** Tasks that matched the active filter (others are shown faded, for context). */
  matched?: Set<string>;
  canEdit?: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  /** Called after a bar is dragged (move) or its end is dragged (resize), in calendar days. */
  onBarDrag?: (task: Task, mode: 'move' | 'resize', days: number) => void;
}

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  dx: number;
}

interface Segment {
  x: number;
  w: number;
  label: string;
}

/** Calendar-day timeline: visible range, header segments and shading. */
function useTimeline(project: Project, rows: Task[], zoom: Zoom, minWidth: number) {
  return useMemo(() => {
    const dw = DAY_WIDTH[zoom];
    const today = todayISO();
    let min = project.startDate;
    let max = project.finishDate || project.startDate;
    for (const t of rows) {
      if (t.start && t.start < min) min = t.start;
      if (t.finish && t.finish > max) max = t.finish;
      if (t.baselineStart && t.baselineStart < min) min = t.baselineStart;
      if (t.baselineFinish && t.baselineFinish > max) max = t.baselineFinish;
    }
    // Pad and align to a Monday (or the 1st of a month in month view).
    let start = addDays(min, zoom === 'month' ? -14 : -3);
    if (zoom === 'month') start = `${start.slice(0, 7)}-01`;
    else start = addDays(start, -((weekday(start) + 6) % 7));
    let end = addDays(max, zoom === 'day' ? 14 : zoom === 'week' ? 35 : 90);
    const minDays = Math.ceil(minWidth / dw) + 1;
    if (diffDays(start, end) < minDays) end = addDays(start, minDays);
    const days = diffDays(start, end) + 1;

    const top: Segment[] = [];
    const bottom: Segment[] = [];
    const nonWorking: number[] = [];
    const working = new Set(project.workingDays);
    const holidays = new Set(project.holidays);

    for (let i = 0; i < days; i++) {
      const iso = addDays(start, i);
      const d = new Date(parseISO(iso));
      const dom = d.getUTCDate();
      const wd = d.getUTCDay();
      if (zoom !== 'month' && (!working.has(wd) || holidays.has(iso))) nonWorking.push(i);

      const topKey = zoom === 'month' ? dom === 1 && d.getUTCMonth() === 0 : dom === 1;
      if (i === 0 || topKey) top.push({ x: i * dw, w: 0, label: zoom === 'month' ? String(d.getUTCFullYear()) : monthLabel(iso) });
      if (zoom === 'day') bottom.push({ x: i * dw, w: dw, label: String(dom) });
      else if (zoom === 'week' && (wd === 1 || i === 0)) bottom.push({ x: i * dw, w: 0, label: `${String(dom).padStart(2, '0')} ${monthLabel(iso, false)}` });
      else if (zoom === 'month' && (dom === 1 || i === 0)) bottom.push({ x: i * dw, w: 0, label: monthLabel(iso, false) });
    }
    const close = (segs: Segment[]) => segs.forEach((s, i) => (s.w = (segs[i + 1]?.x ?? days * dw) - s.x));
    close(top);
    if (zoom !== 'day') close(bottom);

    return { dw, start, days, width: days * dw, top, bottom, nonWorking, todayX: diffDays(start, today) * dw, today };
  }, [project, rows, zoom, minWidth]);
}

export const GanttChart = memo(function GanttChart(props: GanttChartProps) {
  const { project, rows, byId, resourceNames, zoom, showCritical, showBaseline, selectedId, minWidth, themeColor, isDark, matched, canEdit, onSelect, onOpen, onBarDrag } = props;
  const tl = useTimeline(project, rows, zoom, minWidth);
  const [drag, setDrag] = useState<DragState | null>(null);
  const moved = useRef(false);

  const startDrag = (e: React.PointerEvent, t: Task, mode: 'move' | 'resize') => {
    if (!canEdit || !onBarDrag || t.isSummary || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault(); // no text selection while dragging
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    moved.current = false;
    setDrag({ id: t._id, mode, startX: e.clientX, dx: 0 });
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 3) moved.current = true;
    setDrag({ ...drag, dx });
  };
  const endDrag = (t: Task) => {
    if (!drag) return;
    const days = Math.round(drag.dx / tl.dw);
    setDrag(null);
    if (moved.current && days !== 0) onBarDrag?.(t, drag.mode, days);
  };
  const height = Math.max(rows.length * ROW_H, ROW_H * 4);
  const rowIndex = useMemo(() => new Map(rows.map((t, i) => [t._id, i])), [rows]);

  const x = (iso: string) => diffDays(tl.start, iso) * tl.dw;
  const colors = {
    grid: isDark ? '#374151' : '#f3f4f6',
    shade: isDark ? 'rgba(17,24,39,0.55)' : '#f9fafb',
    text: isDark ? '#d1d5db' : '#4b5563',
    muted: isDark ? '#9ca3af' : '#6b7280',
    summary: isDark ? '#d1d5db' : '#374151',
    link: isDark ? '#9ca3af' : '#6b7280',
    critical: '#ef4444',
    baseline: isDark ? '#6b7280' : '#9ca3af',
    selected: isDark ? 'rgba(30,58,138,0.25)' : '#eff6ff',
  };

  const barColor = (t: Task) => (showCritical && t.isCritical ? colors.critical : themeColor);

  // Dependency arrows (only between visible rows)
  const links = useMemo(() => {
    const paths: { d: string; critical: boolean; key: string }[] = [];
    for (const succ of rows) {
      const si = rowIndex.get(succ._id)!;
      for (const l of succ.predecessors) {
        const pred = byId.get(l.task);
        const pi = pred ? rowIndex.get(pred._id) : undefined;
        if (!pred || pi === undefined || !pred.start || !succ.start) continue;
        const pStartX = x(pred.start);
        const pEndX = x(pred.finish) + (pred.isMilestone ? tl.dw / 2 : tl.dw);
        const sStartX = x(succ.start) + (succ.isMilestone ? tl.dw / 2 - 6 : 0);
        const sEndX = x(succ.finish) + (succ.isMilestone ? tl.dw / 2 + 6 : tl.dw);
        const fromEnd = l.type === 'FS' || l.type === 'FF';
        const toStart = l.type === 'FS' || l.type === 'SS';
        const px = fromEnd ? pEndX : pStartX;
        const py = pi * ROW_H + ROW_H / 2;
        const sx = toStart ? sStartX : sEndX;
        const sy = si * ROW_H + ROW_H / 2;
        const x1 = px + (fromEnd ? 8 : -8);
        const midY = si > pi ? si * ROW_H : (si + 1) * ROW_H;
        let d: string;
        if (toStart ? x1 <= sx - 6 : x1 >= sx + 6) d = `M${px},${py} H${x1} V${sy} H${sx}`;
        else d = `M${px},${py} H${x1} V${midY} H${toStart ? sx - 10 : sx + 10} V${sy} H${sx}`;
        paths.push({ d, critical: showCritical && pred.isCritical && succ.isCritical, key: `${pred._id}-${succ._id}` });
      }
    }
    return paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rowIndex, byId, tl, showCritical]);

  return (
    <div style={{ width: tl.width }} className="relative select-none">
      {/* Header */}
      <svg width={tl.width} height={HEADER_H} className="sticky top-0 z-10 block bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700" aria-hidden>
        {tl.top.map((s, i) => (
          <g key={`t${i}`}>
            <line x1={s.x} x2={s.x} y1={0} y2={24} stroke={colors.grid} />
            <text x={s.x + 6} y={16} fontSize={11} fontWeight={600} fill={colors.text}>
              {s.w > 40 ? s.label : ''}
            </text>
          </g>
        ))}
        <line x1={0} x2={tl.width} y1={24} y2={24} stroke={colors.grid} />
        {tl.bottom.map((s, i) => (
          <g key={`b${i}`}>
            <line x1={s.x} x2={s.x} y1={24} y2={HEADER_H} stroke={colors.grid} />
            <text x={s.x + s.w / 2} y={40} fontSize={10} textAnchor="middle" fill={colors.muted}>
              {s.w > 14 ? s.label : ''}
            </text>
          </g>
        ))}
        {tl.todayX >= 0 && tl.todayX <= tl.width && <rect x={tl.todayX} y={24} width={tl.dw} height={24} fill={colors.critical} opacity={0.12} />}
      </svg>

      {/* Body */}
      <svg width={tl.width} height={height} className="block" role="img" aria-label="Gantt chart">
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={colors.link} />
          </marker>
          <marker id="arr-crit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={colors.critical} />
          </marker>
        </defs>

        {tl.nonWorking.map((i) => (
          <rect key={i} x={i * tl.dw} y={0} width={tl.dw} height={height} fill={colors.shade} />
        ))}
        {rows.map((t, i) =>
          t._id === selectedId ? <rect key={`sel-${t._id}`} x={0} y={i * ROW_H} width={tl.width} height={ROW_H} fill={colors.selected} /> : null,
        )}
        {rows.map((_, i) => (
          <line key={`h${i}`} x1={0} x2={tl.width} y1={(i + 1) * ROW_H - 0.5} y2={(i + 1) * ROW_H - 0.5} stroke={colors.grid} />
        ))}
        {tl.todayX >= 0 && tl.todayX <= tl.width && (
          <line x1={tl.todayX + tl.dw / 2} x2={tl.todayX + tl.dw / 2} y1={0} y2={height} stroke={colors.critical} strokeDasharray="4 3" strokeWidth={1.5} />
        )}

        {links.map((l) => (
          <path key={l.key} d={l.d} fill="none" stroke={l.critical ? colors.critical : colors.link} strokeWidth={1.2} markerEnd={`url(#${l.critical ? 'arr-crit' : 'arr'})`} />
        ))}

        {rows.map((t, i) => {
          if (!t.start) return null;
          const y = i * ROW_H;
          const dragging = drag?.id === t._id ? drag : null;
          const bx = x(t.start) + (dragging?.mode === 'move' ? dragging.dx : 0);
          const bw = Math.max(tl.dw, (diffDays(t.start, t.finish) + 1) * tl.dw + (dragging?.mode === 'resize' ? dragging.dx : 0));
          const faded = matched && !matched.has(t._id);
          const draggable = canEdit && !!onBarDrag && !t.isSummary;
          const color = barColor(t);
          const tip = `${t.name}\n${fmtDate(t.start)} → ${fmtDate(t.finish)}\n${t.duration} working day${t.duration === 1 ? '' : 's'} · ${t.percentComplete}% complete${t.isCritical ? '\nOn the critical path' : ''}`;
          const label = t.isMilestone ? fmtDate(t.start) : t.resources.map((r) => resourceNames.get(r)).filter(Boolean).join(', ');
          const handlers = {
            onClick: () => !moved.current && onSelect(t._id),
            onDoubleClick: () => onOpen(t._id),
            onPointerDown: (e: React.PointerEvent) => startDrag(e, t, 'move'),
            onPointerMove: onDragMove,
            onPointerUp: () => endDrag(t),
            style: { cursor: draggable ? (dragging ? 'grabbing' : 'grab') : 'pointer', opacity: faded ? 0.35 : 1 },
          };

          return (
            <g key={t._id} {...handlers}>
              <title>{tip}</title>
              {showBaseline && t.baselineStart && t.baselineFinish && (
                <rect
                  x={x(t.baselineStart)}
                  y={y + 28}
                  width={(diffDays(t.baselineStart, t.baselineFinish) + 1) * tl.dw}
                  height={4}
                  rx={1}
                  fill={colors.baseline}
                />
              )}
              {t.isSummary ? (
                <g fill={showCritical && t.isCritical ? colors.critical : colors.summary}>
                  <rect x={bx} y={y + 11} width={bw} height={7} rx={1} />
                  <path d={`M${bx},${y + 11} h8 v7 l-4,6 l-4,-6 z`} />
                  <path d={`M${bx + bw - 8},${y + 11} h8 v7 l-4,6 l-4,-6 z`} />
                </g>
              ) : t.isMilestone ? (
                <rect
                  x={bx + tl.dw / 2 - 6}
                  y={y + ROW_H / 2 - 6}
                  width={12}
                  height={12}
                  transform={`rotate(45 ${bx + tl.dw / 2} ${y + ROW_H / 2})`}
                  fill={showCritical && t.isCritical ? colors.critical : colors.summary}
                />
              ) : (
                <>
                  <rect x={bx} y={y + 9} width={bw} height={18} rx={4} fill={color} opacity={0.35} />
                  {t.percentComplete > 0 && <rect x={bx} y={y + 9} width={(bw * t.percentComplete) / 100} height={18} rx={4} fill={color} />}
                  {t._id === selectedId && <rect x={bx - 1} y={y + 8} width={bw + 2} height={20} rx={5} fill="none" stroke={color} strokeWidth={1.5} />}
                  {draggable && (
                    <rect
                      x={bx + bw - 6}
                      y={y + 9}
                      width={8}
                      height={18}
                      fill="transparent"
                      style={{ cursor: 'ew-resize' }}
                      onPointerDown={(e) => startDrag(e, t, 'resize')}
                      onPointerMove={onDragMove}
                      onPointerUp={() => endDrag(t)}
                    >
                      <title>Drag to change the duration</title>
                    </rect>
                  )}
                </>
              )}
              {dragging && (
                <text x={bx} y={y + 6} fontSize={10} fontWeight={600} fill={colors.text}>
                  {dragging.mode === 'move' ? fmtDate(addDays(t.start, Math.round(dragging.dx / tl.dw))) : `→ ${fmtDate(addDays(t.finish, Math.round(dragging.dx / tl.dw)))}`}
                </text>
              )}
              {label && (
                <text x={bx + (t.isMilestone ? tl.dw / 2 + 12 : bw + 6)} y={y + ROW_H / 2 + 4} fontSize={11} fill={colors.muted}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
});
