import type { CustomField, Project, Resource, Status, Task, TaskType, UserRef, ViewConfig, ViewFilter } from './types';

/**
 * Client-side query engine shared by the Gantt, table, board and calendar views.
 * A project's whole plan is already loaded, so filtering/sorting/grouping run in the browser.
 */

export interface QueryContext {
  project: Project;
  today: string;
  types: Map<string, TaskType>;
  statuses: Map<string, Status>;
  people: Map<string, UserRef>;
  resources: Map<string, Resource>;
  categories: Map<string, string>;
}

export type FieldKind = 'text' | 'enum' | 'date' | 'number' | 'bool';

export interface FieldOption {
  value: string;
  label: string;
  color?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** Raw value used for filtering and grouping (enum: id or '' for none). */
  value: (t: Task, ctx: QueryContext) => string | number | boolean | string[] | null;
  /** Human-readable value for tables and exports. */
  display: (t: Task, ctx: QueryContext) => string;
  options?: (ctx: QueryContext) => FieldOption[];
  groupable?: boolean;
  sortable?: boolean;
  /** Default table column width in px. */
  width?: number;
}

export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', immediate: 'Immediate' };
export const PRIORITY_COLORS: Record<string, string> = { low: '#6b7280', normal: '#3b82f6', high: '#f59e0b', immediate: '#ef4444' };

export const readableId = (t: Pick<Task, 'number'>, project: Pick<Project, 'key'>) => (t.number ? `${project.key}-${t.number}` : '');

const person = (id: string | null, ctx: QueryContext) => (id ? ctx.people.get(id)?.name ?? 'Former member' : '');
const peopleOptions = (ctx: QueryContext): FieldOption[] => [...ctx.people.values()].map((u) => ({ value: u._id, label: u.name }));

export const FIELDS: FieldDef[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (t, c) => readableId(t, c.project), display: (t, c) => readableId(t, c.project), sortable: true, width: 90 },
  { key: 'name', label: 'Subject', kind: 'text', value: (t) => t.name, display: (t) => t.name, sortable: true, width: 300 },
  {
    key: 'type',
    label: 'Type',
    kind: 'enum',
    value: (t) => t.type ?? '',
    display: (t, c) => c.types.get(t.type ?? '')?.name ?? '',
    options: (c) => [...c.types.values()].map((x) => ({ value: x._id, label: x.name, color: x.color })),
    groupable: true,
    sortable: true,
    width: 110,
  },
  {
    key: 'status',
    label: 'Status',
    kind: 'enum',
    value: (t) => t.status ?? '',
    display: (t, c) => c.statuses.get(t.status ?? '')?.name ?? '',
    options: (c) => [...c.statuses.values()].map((x) => ({ value: x._id, label: x.name, color: x.color })),
    groupable: true,
    sortable: true,
    width: 130,
  },
  {
    key: 'priority',
    label: 'Priority',
    kind: 'enum',
    value: (t) => t.priority ?? 'normal',
    display: (t) => PRIORITY_LABELS[t.priority ?? 'normal'],
    options: () => Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label, color: PRIORITY_COLORS[value] })),
    groupable: true,
    sortable: true,
    width: 100,
  },
  { key: 'assignee', label: 'Assignee', kind: 'enum', value: (t) => t.assignee ?? '', display: (t, c) => person(t.assignee, c), options: peopleOptions, groupable: true, sortable: true, width: 150 },
  { key: 'accountable', label: 'Accountable', kind: 'enum', value: (t) => t.accountable ?? '', display: (t, c) => person(t.accountable, c), options: peopleOptions, groupable: true, sortable: true, width: 150 },
  {
    key: 'category',
    label: 'Category',
    kind: 'enum',
    value: (t) => t.category ?? '',
    display: (t, c) => c.categories.get(t.category ?? '') ?? '',
    options: (c) => [...c.categories.entries()].map(([value, label]) => ({ value, label })),
    groupable: true,
    sortable: true,
    width: 130,
  },
  {
    key: 'resources',
    label: 'Resources',
    kind: 'enum',
    value: (t) => t.resources,
    display: (t, c) => t.resources.map((r) => c.resources.get(r)?.name).filter(Boolean).join(', '),
    options: (c) => [...c.resources.values()].map((r) => ({ value: r._id, label: r.name })),
    width: 160,
  },
  { key: 'start', label: 'Start', kind: 'date', value: (t) => t.start, display: (t) => t.start, sortable: true, width: 110 },
  { key: 'finish', label: 'Finish', kind: 'date', value: (t) => t.finish, display: (t) => t.finish, sortable: true, width: 110 },
  { key: 'duration', label: 'Duration', kind: 'number', value: (t) => t.duration, display: (t) => `${t.duration}d`, sortable: true, width: 90 },
  { key: 'percentComplete', label: '% Done', kind: 'number', value: (t) => t.percentComplete, display: (t) => `${t.percentComplete}%`, sortable: true, width: 90 },
  { key: 'critical', label: 'Critical', kind: 'bool', value: (t) => t.isCritical, display: (t) => (t.isCritical ? 'Yes' : ''), groupable: true, width: 80 },
  { key: 'overdue', label: 'Overdue', kind: 'bool', value: (t, c) => !!t.finish && t.finish < c.today && t.percentComplete < 100, display: (t, c) => (t.finish < c.today && t.percentComplete < 100 ? 'Yes' : ''), width: 80 },
  { key: 'milestone', label: 'Milestone', kind: 'bool', value: (t) => t.isMilestone, display: (t) => (t.isMilestone ? 'Yes' : ''), width: 90 },
  { key: 'summary', label: 'Summary task', kind: 'bool', value: (t) => t.isSummary, display: (t) => (t.isSummary ? 'Yes' : ''), width: 90 },
  { key: 'manual', label: 'Manually scheduled', kind: 'bool', value: (t) => t.manual, display: (t) => (t.manual ? 'Yes' : ''), width: 90 },
];

export const FIELD_MAP = new Map(FIELDS.map((f) => [f.key, f]));

export const OPERATORS: Record<FieldKind, { value: string; label: string }[]> = {
  enum: [
    { value: 'in', label: 'is any of' },
    { value: 'not_in', label: 'is none of' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: "doesn't contain" },
  ],
  date: [
    { value: 'before', label: 'is before' },
    { value: 'after', label: 'is on or after' },
    { value: 'next_days', label: 'is within the next N days' },
    { value: 'past', label: 'is in the past' },
  ],
  number: [
    { value: 'gte', label: 'is at least' },
    { value: 'lte', label: 'is at most' },
  ],
  bool: [{ value: 'is', label: 'is' }],
};

export const EMPTY_CONFIG: ViewConfig = { filters: [], search: '', sort: [], groupBy: null, columns: [], options: {} };

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function matchesFilter(t: Task, f: ViewFilter, ctx: QueryContext): boolean {
  const def = FIELD_MAP.get(f.field);
  if (!def) return true;
  const v = def.value(t, ctx);
  switch (f.op) {
    case 'in':
    case 'not_in': {
      const wanted = Array.isArray(f.value) ? f.value : [];
      if (!wanted.length) return true;
      const values = Array.isArray(v) ? v : [String(v ?? '')];
      const hit = values.some((x) => wanted.includes(x));
      return f.op === 'in' ? hit : !hit;
    }
    case 'empty':
      return Array.isArray(v) ? v.length === 0 : !v;
    case 'not_empty':
      return Array.isArray(v) ? v.length > 0 : !!v;
    case 'contains':
    case 'not_contains': {
      const needle = String(f.value ?? '').toLowerCase();
      if (!needle) return true;
      const hit = String(v ?? '').toLowerCase().includes(needle);
      return f.op === 'contains' ? hit : !hit;
    }
    case 'before':
      return !f.value || (!!v && String(v) < String(f.value));
    case 'after':
      return !f.value || (!!v && String(v) >= String(f.value));
    case 'next_days': {
      const n = Number(f.value ?? 7);
      return !!v && String(v) >= ctx.today && String(v) <= addDays(ctx.today, n);
    }
    case 'past':
      return !!v && String(v) < ctx.today;
    case 'gte':
      return f.value === '' || f.value == null || Number(v) >= Number(f.value);
    case 'lte':
      return f.value === '' || f.value == null || Number(v) <= Number(f.value);
    case 'is':
      return f.value == null || Boolean(v) === (f.value === true || f.value === 'true');
    default:
      return true;
  }
}

export function matchesConfig(t: Task, config: ViewConfig, ctx: QueryContext): boolean {
  const q = config.search.trim().toLowerCase();
  if (q && !`${t.name} ${readableId(t, ctx.project)} ${t.notes}`.toLowerCase().includes(q)) return false;
  return config.filters.every((f) => matchesFilter(t, f, ctx));
}

export const activeFilterCount = (config: ViewConfig) => config.filters.length + (config.search.trim() ? 1 : 0);

/** Flat filtered + sorted list (table, board, calendar). */
export function runQuery(tasks: Task[], config: ViewConfig, ctx: QueryContext): Task[] {
  const rows = tasks.filter((t) => matchesConfig(t, config, ctx));
  if (!config.sort.length) return rows.sort((a, b) => a.rowNumber - b.rowNumber);
  return rows.sort((a, b) => {
    for (const s of config.sort) {
      const def = FIELD_MAP.get(s.field);
      if (!def) continue;
      const av = def.kind === 'enum' ? def.display(a, ctx) : def.value(a, ctx);
      const bv = def.kind === 'enum' ? def.display(b, ctx) : def.value(b, ctx);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      if (cmp) return s.dir === 'asc' ? cmp : -cmp;
    }
    return a.rowNumber - b.rowNumber;
  });
}

/** Hierarchical filter for the Gantt: keeps matching tasks plus their ancestors (for context). */
export function filterHierarchy(tasks: Task[], config: ViewConfig, ctx: QueryContext): { rows: Task[]; matched: Set<string> } {
  if (!activeFilterCount(config)) return { rows: tasks, matched: new Set(tasks.map((t) => t._id)) };
  const byId = new Map(tasks.map((t) => [t._id, t]));
  const matched = new Set(tasks.filter((t) => matchesConfig(t, config, ctx)).map((t) => t._id));
  const keep = new Set(matched);
  for (const id of matched) {
    let parent = byId.get(id)?.parent;
    while (parent && !keep.has(parent)) {
      keep.add(parent);
      parent = byId.get(parent)?.parent;
    }
  }
  return { rows: tasks.filter((t) => keep.has(t._id)), matched };
}

export interface Group {
  key: string;
  label: string;
  color?: string;
  tasks: Task[];
}

/** Groups rows by a field; group order follows the field's option order. */
export function groupRows(rows: Task[], field: string | null, ctx: QueryContext): Group[] {
  const def = field ? FIELD_MAP.get(field) : undefined;
  if (!def) return [{ key: '', label: '', tasks: rows }];
  const groups = new Map<string, Group>();
  const options = def.options?.(ctx) ?? [];
  for (const o of options) groups.set(o.value, { key: o.value, label: o.label, color: o.color, tasks: [] });
  for (const t of rows) {
    const raw = def.value(t, ctx);
    const key = def.kind === 'bool' ? String(!!raw) : String(raw ?? '');
    if (!groups.has(key)) {
      const label = def.kind === 'bool' ? (raw ? 'Yes' : 'No') : key ? def.display(t, ctx) : `No ${def.label.toLowerCase()}`;
      groups.set(key, { key, label, tasks: [] });
    }
    groups.get(key)!.tasks.push(t);
  }
  return [...groups.values()];
}

// ---- Custom fields ---------------------------------------------------------------------------

export const customKey = (id: string) => `cf:${id}`;

/** Formats a custom field value for display (tables, exports, drawers). */
export function formatCustomValue(field: CustomField, value: unknown, people?: Map<string, UserRef>): string {
  if (value === undefined || value === null || value === '') return '';
  const option = (id: unknown) => field.options.find((o) => o._id === id)?.name ?? '';
  switch (field.kind) {
    case 'select':
      return option(value);
    case 'multiselect':
      return (Array.isArray(value) ? value : []).map(option).filter(Boolean).join(', ');
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'user':
      return people?.get(String(value))?.name ?? '';
    default:
      return String(value);
  }
}

/**
 * Registers the organisation's task custom fields as query-engine fields (keys `cf:<id>`), so they
 * work in filters, columns, sorting and grouping everywhere. Called whenever the catalog loads.
 */
export function syncCustomFields(fields: CustomField[]) {
  for (let i = FIELDS.length - 1; i >= 0; i--) if (FIELDS[i].key.startsWith('cf:')) FIELDS.splice(i, 1);
  for (const key of [...FIELD_MAP.keys()]) if (key.startsWith('cf:')) FIELD_MAP.delete(key);
  for (const f of fields.filter((x) => x.scope === 'task')) {
    const kind: FieldKind =
      f.kind === 'select' || f.kind === 'multiselect' || f.kind === 'user' ? 'enum' : f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : f.kind === 'boolean' ? 'bool' : 'text';
    const def: FieldDef = {
      key: customKey(f._id),
      label: f.name,
      kind,
      value: (t) => {
        const v = t.customValues?.[f._id];
        if (kind === 'enum') return Array.isArray(v) ? (v as string[]) : v == null ? '' : String(v);
        if (kind === 'bool') return v === true;
        return (v as string | number | undefined) ?? null;
      },
      display: (t, c) => formatCustomValue(f, t.customValues?.[f._id], c.people),
      options:
        f.kind === 'user'
          ? (c) => [...c.people.values()].map((u) => ({ value: u._id, label: u.name }))
          : f.kind === 'select' || f.kind === 'multiselect'
            ? () => f.options.map((o) => ({ value: o._id, label: o.name }))
            : undefined,
      groupable: f.kind === 'select' || f.kind === 'user' || f.kind === 'boolean',
      sortable: f.kind !== 'multiselect' && f.kind !== 'longtext',
      width: 140,
    };
    FIELDS.push(def);
    FIELD_MAP.set(def.key, def);
  }
}
