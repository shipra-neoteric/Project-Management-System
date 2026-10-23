'use client';

import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Diamond, Pencil, StickyNote } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { fmtShort } from '@/lib/dates';
import { taskStatus } from '@/lib/status';
import type { Task } from '@/lib/types';
import { HEADER_H, ROW_H } from './GanttChart';
import { formatPredecessors } from './predecessors';

export type EditableField = 'name' | 'duration' | 'start' | 'predecessors' | 'percentComplete';

export const GRID_COLUMNS = [
  { key: 'row', label: '#', width: 44 },
  { key: 'ind', label: '', width: 30 },
  { key: 'name', label: 'Task name', width: 280 },
  { key: 'duration', label: 'Duration', width: 84 },
  { key: 'start', label: 'Start', width: 112 },
  { key: 'finish', label: 'Finish', width: 112 },
  { key: 'predecessors', label: 'Predecessors', width: 110 },
  { key: 'resources', label: 'Resources', width: 150 },
  { key: 'percentComplete', label: '% Done', width: 72 },
] as const;
export const GRID_FULL_WIDTH = GRID_COLUMNS.reduce((a, c) => a + c.width, 0);
/** Width up to and including the Finish column — the default view. */
export const GRID_DEFAULT_WIDTH = 44 + 30 + 280 + 84 + 112 + 112;

interface TaskGridProps {
  rows: Task[];
  byId: Map<string, Task>;
  resourceNames: Map<string, string>;
  selectedId: string | null;
  collapsed: Set<string>;
  canEdit: boolean;
  today: string;
  editRequest: { taskId: string; field: EditableField; nonce: number } | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onCommit: (task: Task, field: EditableField, value: string) => void;
}

const cellBase = 'h-full flex items-center px-2 text-sm whitespace-nowrap border-r border-gray-100 dark:border-gray-700/60 shrink-0 overflow-hidden';

export const TaskGrid = memo(function TaskGrid(props: TaskGridProps) {
  const { rows, byId, resourceNames, selectedId, collapsed, canEdit, today, editRequest, onSelect, onOpen, onToggle, onCommit } = props;
  const [editing, setEditing] = useState<{ taskId: string; field: EditableField } | null>(null);

  useEffect(() => {
    if (editRequest) setEditing({ taskId: editRequest.taskId, field: editRequest.field });
  }, [editRequest]);

  const startEdit = (task: Task, field: EditableField) => {
    onSelect(task._id);
    if (!canEdit) return;
    if (task.isSummary && (field === 'duration' || field === 'percentComplete')) return;
    setEditing({ taskId: task._id, field });
  };

  return (
    <div style={{ width: GRID_FULL_WIDTH }}>
      <div
        className="sticky top-0 z-10 flex bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700"
        style={{ height: HEADER_H }}
      >
        {GRID_COLUMNS.map((c) => (
          <div
            key={c.key}
            style={{ width: c.width }}
            className="h-full flex items-end pb-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r border-gray-200 dark:border-gray-700 shrink-0 whitespace-nowrap"
          >
            {c.label}
          </div>
        ))}
      </div>

      {rows.map((t) => {
        const selected = t._id === selectedId;
        const status = taskStatus(t, today);
        const isEditing = (field: EditableField) => editing?.taskId === t._id && editing.field === field;
        const editor = (field: EditableField, initial: string, type: 'text' | 'number' | 'date' = 'text') =>
          isEditing(field) ? (
            <InlineEditor
              initial={initial}
              type={type}
              onCancel={() => setEditing(null)}
              onCommit={(v) => {
                setEditing(null);
                if (v !== initial) onCommit(t, field, v);
              }}
            />
          ) : null;

        return (
          <div
            key={t._id}
            style={{ height: ROW_H }}
            onClick={() => onSelect(t._id)}
            className={cn(
              'flex border-b border-gray-100 dark:border-gray-700/60 group cursor-default',
              selected ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50',
              t.isSummary && 'font-semibold',
            )}
          >
            {/* # */}
            <div style={{ width: 44 }} className={cn(cellBase, 'justify-between text-xs text-gray-400 tabular-nums font-normal')} onDoubleClick={() => onOpen(t._id)}>
              <span>{t.rowNumber}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(t._id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-blue-600 transition-opacity"
                title="Open task details"
                aria-label={`Open details for ${t.name}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>

            {/* Indicators */}
            <div style={{ width: 30 }} className={cn(cellBase, 'justify-center gap-0.5 px-0')}>
              {status === 'overdue' && !t.isSummary && (
                <span title="Overdue">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                </span>
              )}
              {status === 'completed' && (
                <span title="Completed">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                </span>
              )}
              {status !== 'overdue' && status !== 'completed' && t.constraintStart && (
                <span title={`Start no earlier than ${t.constraintStart}`}>
                  <CalendarClock className="w-3.5 h-3.5 text-blue-500" />
                </span>
              )}
              {status !== 'overdue' && status !== 'completed' && !t.constraintStart && t.notes && (
                <span title={t.notes}>
                  <StickyNote className="w-3.5 h-3.5 text-gray-400" />
                </span>
              )}
            </div>

            {/* Name */}
            <div style={{ width: 280 }} className={cellBase} onClick={() => selected && startEdit(t, 'name')} onDoubleClick={() => startEdit(t, 'name')}>
              {editor('name', t.name) ?? (
                <div className="flex items-center gap-1 min-w-0 w-full" style={{ paddingLeft: t.outlineLevel * 16 }}>
                  {t.isSummary ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(t._id);
                      }}
                      className="p-0.5 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 shrink-0"
                      aria-label={collapsed.has(t._id) ? 'Expand' : 'Collapse'}
                      title={collapsed.has(t._id) ? 'Expand' : 'Collapse'}
                    >
                      {collapsed.has(t._id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  ) : t.isMilestone ? (
                    <Diamond className="w-3.5 h-3.5 text-gray-500 shrink-0 ml-0.5 mr-0.5" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="truncate text-gray-900 dark:text-white" title={t.name}>
                    {t.name}
                  </span>
                </div>
              )}
            </div>

            {/* Duration */}
            <div style={{ width: 84 }} className={cn(cellBase, 'tabular-nums text-gray-700 dark:text-gray-300')} onClick={() => selected && startEdit(t, 'duration')} onDoubleClick={() => startEdit(t, 'duration')}>
              {editor('duration', String(t.duration), 'number') ?? `${t.duration} day${t.duration === 1 ? '' : 's'}`}
            </div>

            {/* Start */}
            <div style={{ width: 112 }} className={cn(cellBase, 'tabular-nums text-gray-700 dark:text-gray-300 font-normal')} onClick={() => selected && !t.isSummary && startEdit(t, 'start')} onDoubleClick={() => !t.isSummary && startEdit(t, 'start')}>
              {editor('start', t.constraintStart ?? t.start, 'date') ?? fmtShort(t.start)}
            </div>

            {/* Finish */}
            <div style={{ width: 112 }} className={cn(cellBase, 'tabular-nums text-gray-700 dark:text-gray-300 font-normal')} title="Calculated from start and duration">
              {fmtShort(t.finish)}
            </div>

            {/* Predecessors */}
            <div style={{ width: 110 }} className={cn(cellBase, 'text-gray-700 dark:text-gray-300 font-normal')} onClick={() => selected && startEdit(t, 'predecessors')} onDoubleClick={() => startEdit(t, 'predecessors')}>
              {editor('predecessors', formatPredecessors(t.predecessors, byId)) ?? <span className="truncate">{formatPredecessors(t.predecessors, byId)}</span>}
            </div>

            {/* Resources */}
            <div style={{ width: 150 }} className={cn(cellBase, 'text-gray-700 dark:text-gray-300 font-normal')} onDoubleClick={() => onOpen(t._id)} title="Double-click to assign resources">
              <span className="truncate">{t.resources.map((r) => resourceNames.get(r)).filter(Boolean).join(', ')}</span>
            </div>

            {/* % complete */}
            <div style={{ width: 72 }} className={cn(cellBase, 'tabular-nums text-gray-700 dark:text-gray-300')} onClick={() => selected && startEdit(t, 'percentComplete')} onDoubleClick={() => startEdit(t, 'percentComplete')}>
              {editor('percentComplete', String(t.percentComplete), 'number') ?? `${t.percentComplete}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
});

function InlineEditor({ initial, type, onCommit, onCancel }: { initial: string; type: 'text' | 'number' | 'date'; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    if (type !== 'date') ref.current?.select();
  }, [type]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value.trim() ?? initial);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      type={type}
      defaultValue={initial}
      min={type === 'number' ? 0 : undefined}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      className="w-full h-7 px-1.5 text-sm font-normal rounded border border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
    />
  );
}
