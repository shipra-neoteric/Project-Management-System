import { ProgressBar } from '@/components/ui/Feedback';
import { Avatar, PriorityBadge, StatusBadge, TypeLabel } from '@/components/ui/TaskBits';
import { fmtDate } from '@/lib/dates';
import { FIELD_MAP, readableId, type QueryContext } from '@/lib/query';
import type { Task } from '@/lib/types';

/** Renders one task field consistently across the table, board cards and exports. */
export function TaskCell({ field, task, ctx }: { field: string; task: Task; ctx: QueryContext }) {
  switch (field) {
    case 'id':
      return <span className="text-xs font-mono font-medium theme-text">{readableId(task, ctx.project)}</span>;
    case 'type':
      return <TypeLabel type={task.type ? ctx.types.get(task.type) : undefined} />;
    case 'status':
      return <StatusBadge status={task.status ? ctx.statuses.get(task.status) : undefined} />;
    case 'priority':
      return <PriorityBadge priority={task.priority ?? 'normal'} />;
    case 'assignee':
    case 'accountable': {
      const id = task[field];
      const name = id ? ctx.people.get(id)?.name : undefined;
      return name ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
          <Avatar size="xs" name={name} /> {name}
        </span>
      ) : null;
    }
    case 'start':
    case 'finish':
      return <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap tabular-nums">{fmtDate(task[field])}</span>;
    case 'percentComplete':
      return (
        <span className="flex items-center gap-2 w-28">
          <ProgressBar value={task.percentComplete} />
          <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 w-8 text-right">{task.percentComplete}%</span>
        </span>
      );
    default: {
      const def = FIELD_MAP.get(field);
      const value = def?.display(task, ctx) ?? '';
      return <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{value}</span>;
    }
  }
}
