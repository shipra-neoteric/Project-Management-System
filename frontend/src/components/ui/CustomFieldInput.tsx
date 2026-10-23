'use client';

import { cn } from '@/lib/cn';
import type { CustomField, UserRef } from '@/lib/types';
import { inputCls, textareaCls } from './Field';
import { ThemedSelect } from './ThemedSelect';

/** Editor for one custom field value (task or project). */
export function CustomFieldInput({
  field,
  value,
  onChange,
  people = [],
  disabled,
}: {
  field: CustomField;
  value: unknown;
  onChange: (value: unknown) => void;
  people?: UserRef[];
  disabled?: boolean;
}) {
  const id = `cf-${field._id}`;
  switch (field.kind) {
    case 'longtext':
      return <textarea id={id} rows={3} className={textareaCls} value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input id={id} type="number" className={inputCls} value={value === undefined || value === null ? '' : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date':
      return <input id={id} type="date" className={inputCls} value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />;
    case 'boolean':
      return (
        <label className="inline-flex items-center gap-2 h-10 text-sm text-gray-700 dark:text-gray-200">
          <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
          Yes
        </label>
      );
    case 'select':
    case 'user': {
      const options = field.kind === 'user' ? people.map((p) => ({ value: p._id, label: p.name })) : field.options.map((o) => ({ value: o._id, label: o.name }));
      return <ThemedSelect id={id} options={[{ value: '', label: '—' }, ...options]} value={String(value ?? '')} disabled={disabled} searchable={options.length > 8} onChange={(v) => onChange(v || null)} />;
    }
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => {
            const on = selected.includes(o._id);
            return (
              <button
                key={o._id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onChange(on ? selected.filter((x) => x !== o._id) : [...selected, o._id])}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:cursor-not-allowed',
                  on ? 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                )}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return <input id={id} className={inputCls} value={String(value ?? '')} disabled={disabled} maxLength={255} onChange={(e) => onChange(e.target.value)} />;
  }
}

export const isEmptyValue = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
