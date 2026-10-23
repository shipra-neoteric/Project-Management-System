'use client';

import { CalendarDays, KanbanSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { Avatar, PriorityBadge, TypeLabel } from '@/components/ui/TaskBits';
import { useViewState } from '@/components/views/useViewState';
import { ViewToolbar } from '@/components/views/ViewToolbar';
import { useWorkspace } from '@/features/project-context';
import { useTaskMutations, type TaskAttributes } from '@/features/queries';
import { toastError } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/dates';
import { FIELD_MAP, groupRows, readableId, runQuery } from '@/lib/query';
import { useTheme } from '@/lib/theme';
import type { Priority, Task } from '@/lib/types';

const BOARD_FIELDS = ['status', 'type', 'priority', 'assignee', 'category'];
const DEFAULTS = { groupBy: 'status' };

export default function BoardPage() {
  const { projectId, tasks, ctx, canEdit, isLoading, error, openTask } = useWorkspace();
  const viewState = useViewState(projectId, 'board', DEFAULTS);
  const { config } = viewState;
  const { update } = useTaskMutations(projectId);
  const { themeColor } = useTheme();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);

  const field = config.groupBy && BOARD_FIELDS.includes(config.groupBy) ? config.groupBy : 'status';
  const leaves = useMemo(() => tasks.filter((t) => !t.isSummary), [tasks]);
  const rows = useMemo(() => (ctx ? runQuery(leaves, config, ctx) : []), [leaves, config, ctx]);
  const columns = useMemo(() => {
    if (!ctx) return [];
    const groups = groupRows(rows, field, ctx);
    // Always offer a "none" column for optional fields so cards can be un-assigned.
    if ((field === 'assignee' || field === 'category') && !groups.some((g) => g.key === '')) {
      groups.push({ key: '', label: `No ${FIELD_MAP.get(field)!.label.toLowerCase()}`, tasks: [] });
    }
    return groups;
  }, [rows, field, ctx]);

  if (isLoading) return <PageLoader label="Loading board…" />;
  if (error || !ctx) return <Alert>{errorMessage(error, 'Could not load the board')}</Alert>;

  const drop = async (columnKey: string) => {
    setOverColumn(null);
    const task = dragId ? tasks.find((t) => t._id === dragId) : null;
    setDragId(null);
    if (!task) return;
    const current = String(FIELD_MAP.get(field)!.value(task, ctx) ?? '');
    if (current === columnKey) return;
    const patch: TaskAttributes =
      field === 'priority' ? { priority: columnKey as Priority } : field === 'status' || field === 'type' ? { [field]: columnKey } : { [field]: columnKey || null };
    try {
      await update.mutateAsync({ taskId: task._id, patch });
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      <ViewToolbar kind="board" state={viewState} features={{ group: true }} groupFields={BOARD_FIELDS}>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Columns: <span className="font-medium text-gray-700 dark:text-gray-200">{FIELD_MAP.get(field)!.label}</span>
          {canEdit && ' · drag cards to change'}
        </span>
      </ViewToolbar>

      {leaves.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <EmptyState icon={KanbanSquare} title="No tasks yet" message="Add tasks on the Gantt chart or Table tab; they appear here as cards." />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-2" style={{ minHeight: 400 }}>
          {columns.map((col) => (
            <div
              key={col.key || 'none'}
              onDragOver={(e) => {
                if (!canEdit || !dragId) return;
                e.preventDefault();
                setOverColumn(col.key);
              }}
              onDragLeave={() => setOverColumn((c) => (c === col.key ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                void drop(col.key);
              }}
              className={cn(
                'w-72 shrink-0 rounded-lg bg-gray-100/80 dark:bg-gray-800/60 border flex flex-col transition-colors',
                overColumn === col.key ? 'border-dashed' : 'border-transparent',
              )}
              style={overColumn === col.key ? { borderColor: themeColor } : undefined}
            >
              <div className="px-3 py-2.5 flex items-center gap-2 border-b border-gray-200 dark:border-gray-700">
                {col.color && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />}
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{col.label}</span>
                <span className="ml-auto text-xs font-medium bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5 tabular-nums">{col.tasks.length}</span>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                {col.tasks.map((t) => (
                  <BoardCard key={t._id} task={t} draggable={canEdit} dragging={dragId === t._id} onDragStart={() => setDragId(t._id)} onDragEnd={() => setDragId(null)} onOpen={() => openTask(t._id)} />
                ))}
                {col.tasks.length === 0 && <p className="text-xs text-center text-gray-400 dark:text-gray-500 py-6">{canEdit ? 'Drop cards here' : 'No tasks'}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardCard({ task, draggable, dragging, onDragStart, onDragEnd, onOpen }: { task: Task; draggable: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onOpen: () => void }) {
  const { ctx } = useWorkspace();
  if (!ctx) return null;
  const overdue = task.finish && task.finish < ctx.today && task.percentComplete < 100;
  const assignee = task.assignee ? ctx.people.get(task.assignee)?.name : undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task._id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md p-3 space-y-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono font-medium theme-text">{readableId(task, ctx.project)}</span>
        <TypeLabel type={task.type ? ctx.types.get(task.type) : undefined} />
        <span className="ml-auto">
          <PriorityBadge priority={task.priority ?? 'normal'} showLabel={false} />
        </span>
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">{task.name}</p>
      <ProgressBar value={task.percentComplete} />
      <div className="flex items-center gap-2 text-xs">
        <span className={cn('flex items-center gap-1', overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400')}>
          <CalendarDays className="w-3.5 h-3.5" />
          {task.isMilestone ? fmtDate(task.start) : fmtDate(task.finish)}
        </span>
        <span className="ml-auto">{assignee && <Avatar size="xs" name={assignee} />}</span>
      </div>
    </div>
  );
}
