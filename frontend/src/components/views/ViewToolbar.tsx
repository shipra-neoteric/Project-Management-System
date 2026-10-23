'use client';

import { ArrowDownUp, Bookmark, Columns3, Filter, Layers, Plus, Save, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { inputCls, Sec } from '@/components/ui/Field';
import { SearchInput } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useViewMutations } from '@/features/queries';
import { useWorkspace } from '@/features/project-context';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { activeFilterCount, FIELD_MAP, FIELDS, OPERATORS, type QueryContext } from '@/lib/query';
import { useTheme } from '@/lib/theme';
import type { ViewConfig, ViewFilter, ViewKind } from '@/lib/types';
import type { ViewState } from './useViewState';

interface ViewToolbarProps {
  kind: ViewKind;
  state: ViewState;
  /** Which option sections to show in the drawer. */
  features?: { sort?: boolean; group?: boolean; columns?: boolean };
  /** Allowed group-by fields (default: every groupable field). */
  groupFields?: string[];
  children?: ReactNode;
}

/** Saved-view picker + quick search + "View options" drawer (filters, sort, group, columns). */
export function ViewToolbar({ kind, state, features = {}, groupFields, children }: ViewToolbarProps) {
  const { projectId, ctx, canManage } = useWorkspace();
  const { themeColor } = useTheme();
  const mutations = useViewMutations(projectId);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { config, setConfig, views, activeView, selectView, isDirty } = state;
  const filterCount = activeFilterCount(config);

  const saveAs = async () => {
    const Swal = (await import('sweetalert2')).default;
    const result = await Swal.fire({
      title: 'Save view',
      input: 'text',
      inputLabel: 'View name',
      inputValue: activeView ? `${activeView.name} (copy)` : '',
      inputValidator: (v) => (!v.trim() ? 'Enter a name' : undefined),
      showCancelButton: true,
      confirmButtonText: 'Save',
      confirmButtonColor: themeColor,
      ...(canManage ? { footer: 'Tip: shared views are visible to the whole project team.' } : {}),
    });
    if (!result.isConfirmed) return;
    let isPublic = false;
    if (canManage) {
      const share = await Swal.fire({
        title: 'Share with the team?',
        text: 'Shared views appear for everyone in this project. Private views are only visible to you.',
        showDenyButton: true,
        confirmButtonText: 'Share with team',
        denyButtonText: 'Keep private',
        confirmButtonColor: themeColor,
        denyButtonColor: '#6b7280',
      });
      if (share.isDismissed) return;
      isPublic = share.isConfirmed;
    }
    try {
      const view = await mutations.create.mutateAsync({ name: String(result.value).trim(), kind, isPublic, config });
      selectView(view);
      void toastSuccess('View saved');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const saveCurrent = async () => {
    if (!activeView) return saveAs();
    try {
      const view = await mutations.update.mutateAsync({ id: activeView._id, config });
      selectView(view);
      void toastSuccess('View updated');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const deleteView = async () => {
    if (!activeView || !(await confirmDanger(`Delete the view "${activeView.name}"?`, 'The tasks are not affected.'))) return;
    try {
      await mutations.remove.mutateAsync(activeView._id);
      selectView(null);
      void toastSuccess('View deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const viewOptions = [
    { value: '', label: 'All tasks (default)' },
    ...views.map((v) => ({ value: v._id, label: v.name, description: v.isPublic ? 'Shared with team' : 'Private' })),
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2 no-print">
      <div className="w-48">
        <ThemedSelect compact options={viewOptions} value={activeView?._id ?? ''} onChange={(id) => selectView(views.find((v) => v._id === id) ?? null)} />
      </div>
      {(isDirty || (!activeView && filterCount > 0)) && (
        <Button size="sm" icon={Save} onClick={saveCurrent} loading={mutations.create.isPending || mutations.update.isPending}>
          {activeView ? 'Save' : 'Save view'}
        </Button>
      )}
      {activeView && <IconButton icon={Bookmark} label="Save as a new view" onClick={saveAs} />}
      {activeView && <IconButton icon={Trash2} label="Delete this saved view" onClick={deleteView} className="hover:!text-red-500" />}
      <SearchInput value={config.search} onChange={(search) => setConfig((c) => ({ ...c, search }))} placeholder="Filter by text or ID…" />
      <Button size="sm" icon={SlidersHorizontal} onClick={() => setOptionsOpen(true)}>
        View options
        {filterCount > 0 && (
          <span className="ml-0.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-semibold text-white flex items-center justify-center" style={{ backgroundColor: themeColor }}>
            {filterCount}
          </span>
        )}
      </Button>
      {ctx && <FilterChips config={config} setConfig={setConfig} ctx={ctx} />}
      <div className="ml-auto flex items-center gap-2 flex-wrap">{children}</div>

      {ctx && (
        <ViewOptionsDrawer
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          config={config}
          setConfig={setConfig}
          ctx={ctx}
          features={features}
          groupFields={groupFields}
        />
      )}
    </div>
  );
}

function FilterChips({ config, setConfig, ctx }: { config: ViewConfig; setConfig: ViewState['setConfig']; ctx: QueryContext }) {
  if (!config.filters.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {config.filters.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
          {describeFilter(f, ctx)}
          <button
            type="button"
            onClick={() => setConfig((c) => ({ ...c, filters: c.filters.filter((_, j) => j !== i) }))}
            className="p-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/40"
            aria-label="Remove filter"
            title="Remove filter"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function describeFilter(f: ViewFilter, ctx: QueryContext): string {
  const def = FIELD_MAP.get(f.field);
  if (!def) return f.field;
  const op = OPERATORS[def.kind].find((o) => o.value === f.op)?.label ?? f.op;
  let value = '';
  if (Array.isArray(f.value)) {
    const labels = new Map((def.options?.(ctx) ?? []).map((o) => [o.value, o.label]));
    value = f.value.map((v) => labels.get(v) ?? `No ${def.label.toLowerCase()}`).join(', ');
  } else if (def.kind === 'bool') value = f.value === false || f.value === 'false' ? 'No' : 'Yes';
  else if (f.value != null) value = String(f.value);
  if (f.op === 'next_days') value = `${f.value ?? 7} days`;
  return `${def.label} ${op}${value ? ` ${value}` : ''}`;
}

function defaultFilter(field: string): ViewFilter {
  const kind = FIELD_MAP.get(field)?.kind ?? 'text';
  const op = OPERATORS[kind][0].value;
  return { field, op, value: kind === 'enum' ? [] : kind === 'bool' ? true : kind === 'date' ? null : '' };
}

function ViewOptionsDrawer({
  open,
  onClose,
  config,
  setConfig,
  ctx,
  features,
  groupFields,
}: {
  open: boolean;
  onClose: () => void;
  config: ViewConfig;
  setConfig: ViewState['setConfig'];
  ctx: QueryContext;
  features: { sort?: boolean; group?: boolean; columns?: boolean };
  groupFields?: string[];
}) {
  const filterFields = FIELDS.map((f) => ({ value: f.key, label: f.label }));
  const updateFilter = (i: number, patch: Partial<ViewFilter>) =>
    setConfig((c) => ({ ...c, filters: c.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));

  const groupOptions = [
    { value: '', label: 'No grouping' },
    ...FIELDS.filter((f) => f.groupable && (!groupFields || groupFields.includes(f.key))).map((f) => ({ value: f.key, label: f.label })),
  ];
  const sortOptions = FIELDS.filter((f) => f.sortable).map((f) => ({ value: f.key, label: f.label }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      icon={SlidersHorizontal}
      title="View options"
      subtitle="Changes apply immediately. Save the view to keep them."
      width="md"
      footer={
        <>
          <Button inDrawer onClick={() => setConfig((c) => ({ ...c, filters: [], search: '' }))}>
            Clear filters
          </Button>
          <Button inDrawer variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <section>
          <Sec title="Filters" icon={Filter} />
          <div className="space-y-3">
            {config.filters.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500">No filters. All tasks are shown.</p>}
            {config.filters.map((f, i) => {
              const def = FIELD_MAP.get(f.field);
              if (!def) return null;
              return (
                <div key={i} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <ThemedSelect compact options={filterFields} value={f.field} onChange={(field) => updateFilter(i, defaultFilter(field))} />
                    </div>
                    <div className="flex-1">
                      <ThemedSelect compact options={OPERATORS[def.kind]} value={f.op} onChange={(op) => updateFilter(i, { op })} />
                    </div>
                    <IconButton icon={X} label="Remove filter" onClick={() => setConfig((c) => ({ ...c, filters: c.filters.filter((_, j) => j !== i) }))} />
                  </div>
                  <FilterValue filter={f} ctx={ctx} onChange={(value) => updateFilter(i, { value })} />
                </div>
              );
            })}
            <Button inDrawer size="sm" icon={Plus} onClick={() => setConfig((c) => ({ ...c, filters: [...c.filters, defaultFilter('status')] }))}>
              Add filter
            </Button>
          </div>
        </section>

        {features.group && (
          <section>
            <Sec title="Group by" icon={Layers} />
            <ThemedSelect options={groupOptions} value={config.groupBy ?? ''} onChange={(v) => setConfig((c) => ({ ...c, groupBy: v || null }))} />
          </section>
        )}

        {features.sort && (
          <section>
            <Sec title="Sort by" icon={ArrowDownUp} />
            <div className="space-y-2">
              {config.sort.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1">
                    <ThemedSelect compact options={sortOptions} value={s.field} onChange={(field) => setConfig((c) => ({ ...c, sort: c.sort.map((x, j) => (j === i ? { ...x, field } : x)) }))} />
                  </div>
                  <div className="w-36">
                    <ThemedSelect
                      compact
                      options={[
                        { value: 'asc', label: 'Ascending' },
                        { value: 'desc', label: 'Descending' },
                      ]}
                      value={s.dir}
                      onChange={(dir) => setConfig((c) => ({ ...c, sort: c.sort.map((x, j) => (j === i ? { ...x, dir: dir as 'asc' | 'desc' } : x)) }))}
                    />
                  </div>
                  <IconButton icon={X} label="Remove sort" onClick={() => setConfig((c) => ({ ...c, sort: c.sort.filter((_, j) => j !== i) }))} />
                </div>
              ))}
              {config.sort.length < 3 && (
                <Button inDrawer size="sm" icon={Plus} onClick={() => setConfig((c) => ({ ...c, sort: [...c.sort, { field: 'start', dir: 'asc' }] }))}>
                  Add sort level
                </Button>
              )}
              {config.sort.length === 0 && <p className="text-xs text-gray-400">Default: plan order.</p>}
            </div>
          </section>
        )}

        {features.columns && (
          <section>
            <Sec title="Columns" icon={Columns3} />
            <div className="grid grid-cols-2 gap-2">
              {FIELDS.filter((f) => f.key !== 'name').map((f) => {
                const on = config.columns.includes(f.key);
                return (
                  <label key={f.key} className={cn('flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer transition-colors', on ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50')}>
                    <input
                      type="checkbox"
                      checked={on}
                      className="w-4 h-4 accent-[var(--theme-primary)]"
                      onChange={() => setConfig((c) => ({ ...c, columns: on ? c.columns.filter((k) => k !== f.key) : [...c.columns, f.key] }))}
                    />
                    <span className="text-gray-700 dark:text-gray-200">{f.label}</span>
                  </label>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}

function FilterValue({ filter, ctx, onChange }: { filter: ViewFilter; ctx: QueryContext; onChange: (v: ViewFilter['value']) => void }) {
  const def = FIELD_MAP.get(filter.field)!;
  if (filter.op === 'empty' || filter.op === 'not_empty' || filter.op === 'past') return null;

  if (def.kind === 'enum') {
    const options = [...(def.options?.(ctx) ?? []), ...(filter.field === 'resources' ? [] : [{ value: '', label: `No ${def.label.toLowerCase()}` }])];
    const selected = Array.isArray(filter.value) ? filter.value : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value || 'none'}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                on ? 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
              )}
            >
              {o.color && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: o.color }} />}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  if (def.kind === 'bool') {
    return (
      <ThemedSelect
        compact
        options={[
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]}
        value={filter.value === false || filter.value === 'false' ? 'false' : 'true'}
        onChange={(v) => onChange(v === 'true')}
      />
    );
  }
  if (def.kind === 'date' && filter.op !== 'next_days') {
    return <input type="date" className={cn(inputCls, 'h-8')} value={String(filter.value ?? '')} onChange={(e) => onChange(e.target.value || null)} aria-label="Date" />;
  }
  return (
    <input
      type={def.kind === 'number' || filter.op === 'next_days' ? 'number' : 'text'}
      className={cn(inputCls, 'h-8')}
      value={String(filter.value ?? '')}
      placeholder={filter.op === 'next_days' ? 'Number of days, e.g. 7' : 'Value'}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Value"
    />
  );
}
