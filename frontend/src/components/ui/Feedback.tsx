'use client';

import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('w-8 h-8 animate-spin text-gray-400', className)} aria-label="Loading" />;
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Spinner />
      {label && <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>}
    </div>
  );
}

const ALERT_TONES = {
  error: { cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400', icon: AlertCircle },
  warning: { cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400', icon: AlertTriangle },
  success: { cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400', icon: CheckCircle2 },
  info: { cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400', icon: Info },
};

export function Alert({ tone = 'error', children, action, className }: { tone?: keyof typeof ALERT_TONES; children: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, icon: Icon } = ALERT_TONES[tone];
  return (
    <div className={cn('flex items-center gap-3 border rounded-lg px-4 py-3', cls, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="w-5 h-5 flex-shrink-0" />
      <div className="text-sm flex-1">{children}</div>
      {action}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, message, action, compact }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-center px-4', compact ? 'py-8' : 'py-16')}>
      <Icon className="w-12 h-12 text-gray-300 dark:text-gray-600" />
      <p className="text-base font-medium text-gray-500 dark:text-gray-400">{title}</p>
      {message && <p className="text-sm text-gray-400 dark:text-gray-500 max-w-sm">{message}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const { themeColor } = useTheme();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cn('w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-all', pct === 100 && 'bg-green-500')}
        style={pct < 100 ? { width: `${pct}%`, backgroundColor: themeColor } : { width: '100%' }}
      />
    </div>
  );
}
