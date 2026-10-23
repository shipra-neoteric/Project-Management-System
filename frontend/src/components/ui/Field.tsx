import { AlertCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Canonical Nexora input class — use for every input/select. */
export const inputCls = [
  'w-full px-3 py-2 text-sm h-10',
  'border border-gray-300 dark:border-gray-600 rounded-md',
  'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
  'bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
  'placeholder-gray-400 dark:placeholder-gray-500',
  'disabled:opacity-60 disabled:cursor-not-allowed',
  'transition-all duration-200',
].join(' ');

export const textareaCls = cn(inputCls, '!h-auto min-h-24 resize-none');

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, required, error, hint, className, children }: FieldProps) {
  return (
    <div className={cn('group', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider group-focus-within:text-blue-500 transition-colors"
      >
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-500 dark:text-red-400 mt-1 flex items-center gap-1" role="alert">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

/** Form section divider (Nexora `Sec`). */
export function Sec({ title, icon: Icon, className }: { title: string; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 mb-5 pb-3 border-b border-gray-100 dark:border-gray-700', className)}>
      {Icon && <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />}
      <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">{title}</span>
    </div>
  );
}
