'use client';

import { Diamond, FolderKanban, ListTodo, Loader2, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSearch } from '@/features/queries';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/dates';

export const OPEN_TASK_EVENT = 'pms:open-task';

/** Header search across all accessible projects and tasks (Ctrl/⌘ + K). */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const results = useSearch(debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMobileOpen(true);
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    const onDown = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  const items = [
    ...(results.data?.projects ?? []).map((p) => ({ kind: 'project' as const, id: p._id, href: `/projects/${p._id}`, title: p.name, meta: p.key, projectId: p._id })),
    ...(results.data?.tasks ?? []).map((t) => ({
      kind: 'task' as const,
      id: t._id,
      href: `/projects/${t.project}?task=${t._id}`,
      title: t.name,
      meta: `${t.projectKey && t.number ? `${t.projectKey}-${t.number} · ` : ''}${t.projectName} · ${fmtDate(t.start)}`,
      projectId: t.project,
      milestone: t.isMilestone,
    })),
  ];

  const go = (item: (typeof items)[number]) => {
    setOpen(false);
    setMobileOpen(false);
    setQuery('');
    router.push(item.href);
    // If we're already on that project, the workspace is mounted — tell it to open the task.
    if (item.kind === 'task') window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: { projectId: item.projectId, taskId: item.id } }));
  };

  const showPanel = open && query.trim().length >= 2;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMobileOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300"
        aria-label="Search"
        title="Search"
      >
        <Search className="w-4 h-4" />
      </button>
      <div
        ref={boxRef}
        className={cn('relative', mobileOpen ? 'fixed md:relative inset-x-2 top-2 z-[70] md:inset-auto md:top-auto md:z-auto' : 'hidden md:block')}
      >
        <div className="relative w-full md:w-72 lg:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && items[active]) {
                go(items[active]);
              } else if (e.key === 'Escape') {
                setOpen(false);
                setMobileOpen(false);
              }
            }}
            placeholder="Search projects & tasks…  (Ctrl+K)"
            aria-label="Search projects and tasks"
            className="w-full h-9 pl-9 pr-9 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm md:shadow-none [&::-webkit-search-cancel-button]:appearance-none"
          />
          {mobileOpen && (
            <button type="button" onClick={() => setMobileOpen(false)} className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" aria-label="Close search">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {showPanel && (
          <div className="absolute left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-down z-50">
            {results.isFetching && !results.data ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> Searching…
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">No matches for “{query.trim()}”</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto custom-scrollbar py-1" role="listbox">
                {items.map((item, i) => {
                  const Icon = item.kind === 'project' ? FolderKanban : item.milestone ? Diamond : ListTodo;
                  return (
                    <li key={`${item.kind}-${item.id}`} role="option" aria-selected={i === active}>
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(item)}
                        className={cn('w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors', i === active ? 'bg-gray-50 dark:bg-gray-700' : '')}
                      >
                        <Icon className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{item.title}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{item.kind === 'project' ? `Project · ${item.meta}` : item.meta}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
