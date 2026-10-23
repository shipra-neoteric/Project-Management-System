import { ArrowDown, ArrowUp, ChevronsUp, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/query';
import type { Priority, Status, TaskType } from '@/lib/types';

/** Status pill using the status' configured color (text label always shown — never color alone). */
export function StatusBadge({ status, className }: { status: Status | undefined; className?: string }) {
  if (!status) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', className)}
      style={{ backgroundColor: `${status.color}1f`, color: status.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  );
}

/** Uppercase type label like OpenProject's "TASK" / "MILESTONE". */
export function TypeLabel({ type, className }: { type: TaskType | undefined; className?: string }) {
  if (!type) return null;
  return (
    <span className={cn('text-[10px] font-bold uppercase tracking-wider whitespace-nowrap', className)} style={{ color: type.color }}>
      {type.name}
    </span>
  );
}

const PRIORITY_ICONS = { low: ArrowDown, normal: Minus, high: ArrowUp, immediate: ChevronsUp };

export function PriorityBadge({ priority, showLabel = true }: { priority: Priority; showLabel?: boolean }) {
  const Icon = PRIORITY_ICONS[priority] ?? Minus;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap" style={{ color: PRIORITY_COLORS[priority] }} title={`${PRIORITY_LABELS[priority]} priority`}>
      <Icon className="w-3.5 h-3.5" />
      {showLabel && PRIORITY_LABELS[priority]}
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function Avatar({ name, size = 'sm' }: { name: string | undefined; size?: 'xs' | 'sm' }) {
  if (!name) return null;
  return (
    <span
      title={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full theme-gradient text-white font-bold shrink-0',
        size === 'xs' ? 'w-5 h-5 text-[9px]' : 'w-7 h-7 text-[10px]',
      )}
    >
      {initials(name)}
    </span>
  );
}
