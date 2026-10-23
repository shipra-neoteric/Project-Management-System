'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface ThemedSelectProps {
  options: SelectOption[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Show a search box (defaults to when there are more than 8 options) */
  searchable?: boolean;
  compact?: boolean;
}

/** Nexora ThemedSelect: button trigger + portal popup that never gets clipped. */
export function ThemedSelect({ options, value, onChange, placeholder = 'Select…', disabled, id, className, searchable, compact }: ThemedSelectProps) {
  const { themeColor } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 0, up: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const showSearch = searchable ?? options.length > 8;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const up = window.innerHeight - r.bottom < 260 && r.top > 260;
      setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: Math.max(r.width, 200), up });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popupRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  }, [open, options, value]);

  const choose = (opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) choose(filtered[highlight]);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 text-sm text-left rounded-md border border-gray-300 dark:border-gray-600',
          'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600/60 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed',
          compact ? 'h-8' : 'h-10',
          className,
        )}
        style={open ? { boxShadow: `0 0 0 2px ${themeColor}` } : undefined}
      >
        <span className={cn('truncate', !selected && 'text-gray-400 dark:text-gray-500')}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            className="fixed z-[10050] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-down"
            style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            onKeyDown={onKeyDown}
          >
            {showSearch && (
              <div className="p-2 border-b border-gray-100 dark:border-gray-700 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(0);
                  }}
                  placeholder="Search…"
                  aria-label="Search options"
                  className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            )}
            <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto custom-scrollbar py-1">
              {filtered.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">No matches</li>}
              {filtered.map((opt, i) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(opt)}
                  className={cn(
                    'px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-2',
                    i === highlight ? 'bg-gray-50 dark:bg-gray-700' : '',
                    'text-gray-700 dark:text-gray-200',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.description && <span className="block text-xs text-gray-400 truncate">{opt.description}</span>}
                  </span>
                  {opt.value === value && <Check className="w-4 h-4 shrink-0" style={{ color: themeColor }} />}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
