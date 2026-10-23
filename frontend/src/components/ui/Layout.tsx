'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

/** Every page: `space-y-4 sm:space-y-6 animate-fade-in pb-20 lg:pb-6` (Nexora §5.4). */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-4 sm:space-y-6 animate-fade-in pb-20 lg:pb-6', className)}>{children}</div>;
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="space-y-2">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400" aria-label="Breadcrumb">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-2 min-w-0">
              {i > 0 && <ChevronRight className="w-3 h-3 shrink-0" />}
              {b.href ? (
                <Link href={b.href} className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors truncate">
                  {b.label}
                </Link>
              ) : (
                <span className="text-gray-900 dark:text-white font-medium truncate">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-medium text-gray-900 dark:text-white truncate">{title}</h1>
          {subtitle && <div className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ children, className, title, icon: Icon, actions }: { children: ReactNode; className?: string; title?: string; icon?: LucideIcon; actions?: ReactNode }) {
  return (
    <div className={cn('bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden', className)}>
      {title && (
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon className="w-4 h-4 text-gray-400" />}
            <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{title}</span>
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  iconColor?: string;
  active?: boolean;
  onClick?: () => void;
}

export function KpiCard({ label, value, icon: Icon, iconColor = 'text-gray-400', active, onClick }: KpiCardProps) {
  const { themeColor } = useTheme();
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-lg p-3 sm:p-4 shadow hover:shadow-lg transition-all duration-200 text-left relative overflow-hidden group',
        onClick ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : 'cursor-default',
      )}
      style={active ? { boxShadow: `0 0 0 2px ${themeColor}` } : undefined}
    >
      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 pr-8">{label}</p>
      <p className="text-2xl sm:text-3xl font-medium text-gray-900 dark:text-white mt-2 tabular-nums">{value}</p>
      <Icon className={cn('absolute bottom-2 right-2 w-6 h-6 transition-all duration-300 group-hover:scale-110', iconColor)} strokeWidth={2.5} />
    </Tag>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">{children}</div>;
}

interface Tab<K extends string> {
  key: K;
  label: string;
  count?: number;
  icon?: LucideIcon;
}

/** Nexora filter-pill tabs (§6.4). */
export function FilterTabs<K extends string>({ tabs, value, onChange }: { tabs: Tab<K>[]; value: K; onChange: (key: K) => void }) {
  const { themeColor } = useTheme();
  return (
    <div className="bg-gray-100 dark:bg-gray-800/50 p-1 rounded-xl border border-gray-200 dark:border-gray-700 flex gap-1 w-fit max-w-full overflow-x-auto no-scrollbar" role="tablist">
      {tabs.map((tab) => {
        const active = tab.key === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap',
              active
                ? 'bg-white dark:bg-gray-700 shadow-md text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
            )}
            style={active ? { color: themeColor } : undefined}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full tabular-nums">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Table primitives with Nexora classes. */
export const th = 'px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap';
export const td = 'px-3 sm:px-6 py-3 sm:py-4';
export const tableCls = 'min-w-full divide-y divide-gray-200 dark:divide-gray-700';
export const theadCls = 'bg-gray-50 dark:bg-gray-900';
export const tbodyCls = 'bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700';
export const rowCls = 'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group';

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full pl-9 pr-3 h-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}
