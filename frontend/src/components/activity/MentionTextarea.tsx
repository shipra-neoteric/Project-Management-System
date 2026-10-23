'use client';

import { useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/TaskBits';
import { textareaCls } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import type { UserRef } from '@/lib/types';

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  people: UserRef[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  onSubmit?: () => void;
  autoFocus?: boolean;
}

/**
 * Textarea with @mention autocomplete. Picking a person inserts `@[Name](userId)`, which the
 * server uses to notify them; comments render it as a highlighted name.
 */
export function MentionTextarea({ value, onChange, people, placeholder, rows = 3, disabled, onSubmit, autoFocus }: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)).slice(0, 6);
  }, [people, query]);

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([\w.\- ]{0,30})$/.exec(before);
    if (m && !m[2].includes('  ')) {
      setQuery({ start: caret - m[2].length - 1, text: m[2] });
      setActive(0);
    } else setQuery(null);
  };

  const pick = (person: UserRef) => {
    if (!query || !ref.current) return;
    const caret = ref.current.selectionStart;
    const token = `@[${person.name}](${person._id}) `;
    const next = value.slice(0, query.start) + token + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + token.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder ?? 'Comment'}
        className={textareaCls}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (query && matches.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(matches.length - 1, a + 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pick(matches[active]);
              return;
            }
            if (e.key === 'Escape') {
              setQuery(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {query && matches.length > 0 && (
        <ul className="absolute left-2 bottom-full mb-1 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-[120] animate-fade-in-down" role="listbox">
          {matches.map((p, i) => (
            <li key={p._id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('w-full flex items-center gap-2 px-3 py-2 text-left', i === active && 'bg-gray-50 dark:bg-gray-700')}
              >
                <Avatar size="xs" name={p.name} />
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900 dark:text-white truncate">{p.name}</span>
                  <span className="block text-xs text-gray-500 truncate">{p.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders comment text with mentions highlighted (text is shown as plain text — never HTML). */
export function CommentText({ text }: { text: string }) {
  const parts = text.split(/(@\[[^\]]{1,80}\]\([a-f0-9]{24}\))/g);
  return (
    <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        const m = /^@\[([^\]]+)\]\(([a-f0-9]{24})\)$/.exec(part);
        return m ? (
          <span key={i} className="font-medium theme-text">
            @{m[1]}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </p>
  );
}
