'use client';

import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTheme } from '@/lib/theme';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  const { isDark, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-gray-50 dark:bg-gray-900">
      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-label="Toggle dark mode"
        title="Toggle dark mode"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-11 h-11 rounded-lg theme-gradient shadow-sm flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="M4 6h9M7 12h10M10 18h10" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">Project Management System</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Plan · Schedule · Deliver</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 sm:p-8">
          <h1 className="text-xl font-medium text-gray-900 dark:text-white">{title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-6">{subtitle}</p>
          {children}
        </div>
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 mt-6">{footer}</p>
      </div>
    </div>
  );
}
