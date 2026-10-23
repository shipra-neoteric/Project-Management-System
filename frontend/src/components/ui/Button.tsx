'use client';

import { Loader2, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
  /** Use rounded-md (inside drawers) instead of rounded-lg */
  inDrawer?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'text-white hover:opacity-90 shadow-sm',
  secondary:
    'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
  danger:
    'text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40 bg-white dark:bg-transparent hover:bg-red-50 dark:hover:bg-red-900/20',
  ghost: 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, inDrawer, className, children, disabled, style, type = 'button', ...rest },
  ref,
) {
  const { themeColor } = useTheme();
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors whitespace-nowrap',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'md' ? 'px-4 py-2 h-10' : 'px-3 py-1.5 h-8',
        inDrawer ? 'rounded-md' : 'rounded-lg',
        VARIANTS[variant],
        className,
      )}
      style={variant === 'primary' ? { backgroundColor: themeColor, ...style } : style}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4" /> : null}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: 'default' | 'edit' | 'delete';
  active?: boolean;
}

export function IconButton({ icon: Icon, label, tone = 'default', active, className, type = 'button', ...rest }: IconButtonProps) {
  const { themeColor } = useTheme();
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-all active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed',
        tone === 'default' &&
          'p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700',
        tone === 'edit' && 'p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20',
        tone === 'delete' && 'p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
        active && 'bg-gray-100 dark:bg-gray-700',
        className,
      )}
      style={active ? { color: themeColor } : undefined}
      {...rest}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
