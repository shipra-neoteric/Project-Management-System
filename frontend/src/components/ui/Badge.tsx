import { cn } from '@/lib/cn';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple';

const TONES: Record<BadgeTone, { badge: string; dot: string }> = {
  success: { badge: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400', dot: 'bg-green-500' },
  warning: { badge: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400', dot: 'bg-amber-500' },
  danger: { badge: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400', dot: 'bg-red-500' },
  info: { badge: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400', dot: 'bg-blue-500' },
  neutral: { badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', dot: 'bg-gray-400' },
  purple: { badge: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400', dot: 'bg-purple-500' },
};

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: BadgeTone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', TONES[tone].badge, className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', TONES[tone].dot)} />}
      {children}
    </span>
  );
}
