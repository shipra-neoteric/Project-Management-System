'use client';

import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

const WIDTHS = { md: 'sm:max-w-xl', default: 'sm:max-w-2xl', lg: 'sm:max-w-3xl' };

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  width?: keyof typeof WIDTHS;
  footer?: ReactNode;
  children: ReactNode;
}

/** Right-side drawer for create/edit/detail views (Nexora §5.6). */
export function Drawer({ open, onClose, title, subtitle, icon: Icon, width = 'default', footer, children }: DrawerProps) {
  const { themeColor } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm z-[100] animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={cn(
          'fixed top-0 right-0 h-full w-full bg-white dark:bg-gray-800 z-[101] flex flex-col shadow-2xl border-l border-gray-200 dark:border-gray-700 animate-slide-in-right',
          WIDTHS[width],
        )}
      >
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-2.5 rounded-lg shadow-inner shrink-0" style={{ backgroundColor: `${themeColor}20` }}>
              <Icon className="w-6 h-6" style={{ color: themeColor }} />
            </div>
            <div className="min-w-0">
              <h2 id="drawer-title" className="text-xl font-bold text-gray-900 dark:text-white truncate">
                {title}
              </h2>
              {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">{children}</div>
        {footer && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-3 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
