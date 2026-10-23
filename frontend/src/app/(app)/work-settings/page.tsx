'use client';

import { ChevronDown, ChevronUp, CircleDot, GitMerge, ListChecks, ListPlus, Milestone, Pencil, Plus, Save, Tags, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, Sec } from '@/components/ui/Field';
import { Card, FilterTabs, Page, PageHeader, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { StatusBadge, TypeLabel } from '@/components/ui/TaskBits';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { AdminGate } from '@/features/AdminGate';
import { useWorkSettings, useWorkSettingsMutations, useWorkflowMutation } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { CustomField, CustomFieldKind, PhaseDefinition, Status, TaskType, WorkSettings, Workflow } from '@/lib/types';
import { OPTIONAL_TASK_FIELDS } from '@/lib/workflow';

type Kind = 'types' | 'statuses' | 'phases' | 'custom-fields';
type Tab = Kind | 'workflow';
type AnyItem = { _id: string; name: string; position: number; color?: string; isDefault?: boolean };
const PRESETS = ['#6b7280', '#3b82f6', '#22c55e', '#14b8a6', '#a855f7', '#8b5cf6', '#f59e0b', '#f97316', '#ef4444', '#ec4899'];
const FIELD_KINDS: { value: CustomFieldKind; label: string }[] = [
  { value: 'text', label: 'Text (one line)' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'List (pick one)' },
  { value: 'multiselect', label: 'List (pick several)' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'user', label: 'Person (project member)' },
];

export default function WorkSettingsPage() {
  return (
    <AdminGate>
      <WorkSettingsContent />
    </AdminGate>
  );
}

function WorkSettingsContent() {
  const { data, isLoading, error } = useWorkSettings();
  const [tab, setTab] = useState<Tab>('types');
  const [editing, setEditing] = useState<{ kind: Kind; item: AnyItem | null } | null>(null);

  if (isLoading) return <PageLoader />;
  if (error || !data) return <Alert>{errorMessage(error)}</Alert>;

  return (
    <Page>
      <PageHeader
        title="Work settings"
        subtitle="Organisation-wide task types, statuses, workflow, custom fields and project phases"
        actions={
          tab !== 'workflow' && (
            <Button variant="primary" icon={Plus} onClick={() => setEditing({ kind: tab, item: null })}>
              Add {tab === 'custom-fields' ? 'field' : tab === 'phases' ? 'phase' : tab === 'types' ? 'type' : 'status'}
            </Button>
          )
        }
      />
      <FilterTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'types', label: 'Task types', icon: Tags, count: data.types.length },
          { key: 'statuses', label: 'Statuses', icon: CircleDot, count: data.statuses.length },
          { key: 'workflow', label: 'Workflow', icon: GitMerge },
          { key: 'custom-fields', label: 'Custom fields', icon: ListPlus, count: data.customFields.length },
          { key: 'phases', label: 'Project phases', icon: Milestone, count: data.phases.length },
        ]}
      />
      {tab === 'workflow' ? (
        <WorkflowEditor data={data} />
      ) : (
        <ItemList kind={tab} data={data} onEdit={(item) => setEditing({ kind: tab, item })} />
      )}
      {editing && <ItemDrawer kind={editing.kind} item={editing.item} data={data} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function ItemList({ kind, data, onEdit }: { kind: Kind; data: WorkSettings; onEdit: (item: AnyItem) => void }) {
  const { remove, update } = useWorkSettingsMutations();
  const list: AnyItem[] = kind === 'types' ? data.types : kind === 'statuses' ? data.statuses : kind === 'phases' ? data.phases : data.customFields;

  const onDelete = async (item: AnyItem) => {
    const extra = kind === 'custom-fields' ? 'All stored values of this field will be deleted.' : 'Only possible when nothing uses it.';
    if (!(await confirmDanger(`Delete "${item.name}"?`, extra))) return;
    try {
      await remove.mutateAsync({ kind, id: item._id });
      void toastSuccess('Deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const move = async (index: number, delta: number) => {
    const a = list[index];
    const b = list[index + delta];
    if (!b) return;
    try {
      const pa = a.position === b.position ? b.position + delta : b.position;
      await update.mutateAsync({ kind, id: a._id, body: { position: pa } });
      await update.mutateAsync({ kind, id: b._id, body: { position: a.position } });
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const describe = (item: AnyItem) => {
    if (kind === 'types') {
      const t = item as TaskType;
      return (
        <>
          {t.isDefault && <Badge tone="info">Default</Badge>}
          {t.isMilestone && <Badge tone="purple">Milestones</Badge>}
          {t.hiddenFields?.length > 0 && <Badge>{t.hiddenFields.length} hidden field{t.hiddenFields.length === 1 ? '' : 's'}</Badge>}
        </>
      );
    }
    if (kind === 'statuses') {
      const s = item as Status;
      return (
        <>
          {s.isDefault && <Badge tone="info">Default</Badge>}
          {s.isClosed && <Badge tone="success">Closed</Badge>}
        </>
      );
    }
    if (kind === 'phases') return (item as PhaseDefinition).gate ? <span className="text-xs text-gray-500">Gate: {(item as PhaseDefinition).gate}</span> : null;
    const f = item as CustomField;
    return (
      <>
        <Badge tone={f.scope === 'task' ? 'info' : 'purple'}>{f.scope === 'task' ? 'Tasks' : 'Projects'}</Badge>
        <Badge>{FIELD_KINDS.find((k) => k.value === f.kind)?.label}</Badge>
        {f.required && <Badge tone="warning">Required</Badge>}
      </>
    );
  };

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className={tableCls}>
          <thead className={theadCls}>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Details</th>
              <th className={`${th} text-right w-40`}>Actions</th>
            </tr>
          </thead>
          <tbody className={tbodyCls}>
            {list.map((item, i) => (
              <tr key={item._id} className={rowCls}>
                <td className={td}>
                  {kind === 'types' ? (
                    <TypeLabel type={item as TaskType} className="text-xs" />
                  ) : kind === 'statuses' ? (
                    <StatusBadge status={item as Status} />
                  ) : (
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                      {item.color && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />}
                      {item.name}
                    </span>
                  )}
                </td>
                <td className={`${td} space-x-1`}>{describe(item)}</td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <div className="flex items-center justify-end gap-1">
                    <IconButton icon={ChevronUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon={ChevronDown} label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                    <IconButton icon={Pencil} label="Edit" tone="edit" onClick={() => onEdit(item)} />
                    {!item.isDefault && <IconButton icon={Trash2} label="Delete" tone="delete" onClick={() => onDelete(item)} />}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-400">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ItemDrawer({ kind, item, data, onClose }: { kind: Kind; item: AnyItem | null; data: WorkSettings; onClose: () => void }) {
  const { create, update } = useWorkSettingsMutations();
  const [name, setName] = useState(item?.name ?? '');
  const [color, setColor] = useState(item?.color ?? PRESETS[1]);
  const [isDefault, setIsDefault] = useState(!!item?.isDefault);
  const [flag, setFlag] = useState(kind === 'types' ? !!(item as TaskType | null)?.isMilestone : !!(item as Status | null)?.isClosed);
  const [hiddenFields, setHiddenFields] = useState<string[]>((item as TaskType | null)?.hiddenFields ?? []);
  const [gate, setGate] = useState((item as PhaseDefinition | null)?.gate ?? '');
  const field = item as CustomField | null;
  const [scope, setScope] = useState<CustomField['scope']>(field?.scope ?? 'task');
  const [fieldKind, setFieldKind] = useState<CustomFieldKind>(field?.kind ?? 'text');
  const [options, setOptions] = useState<{ _id?: string; name: string }[]>(field?.options ?? []);
  const [required, setRequired] = useState(!!field?.required);
  const [description, setDescription] = useState(field?.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const label = kind === 'types' ? 'type' : kind === 'statuses' ? 'status' : kind === 'phases' ? 'project phase' : 'custom field';
  const hasColor = kind !== 'custom-fields';

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('Name is required');
    const body: Record<string, unknown> = { name: name.trim() };
    if (hasColor) body.color = color;
    if (kind === 'types') Object.assign(body, { isMilestone: flag, hiddenFields, ...(isDefault ? { isDefault: true } : {}) });
    if (kind === 'statuses') Object.assign(body, { isClosed: flag, ...(isDefault ? { isDefault: true } : {}) });
    if (kind === 'phases') body.gate = gate.trim();
    if (kind === 'custom-fields') {
      const cleaned = options.map((o) => ({ ...o, name: o.name.trim() })).filter((o) => o.name);
      if ((fieldKind === 'select' || fieldKind === 'multiselect') && !cleaned.length) return setError('Add at least one option');
      Object.assign(body, { required, description, ...(item ? {} : { scope, kind: fieldKind }), ...(fieldKind === 'select' || fieldKind === 'multiselect' ? { options: cleaned } : {}) });
    }
    try {
      if (item) await update.mutateAsync({ kind, id: item._id, body });
      else await create.mutateAsync({ kind, body });
      void toastSuccess('Saved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const taskFields = data.customFields.filter((f) => f.scope === 'task');

  return (
    <Drawer
      open
      onClose={onClose}
      icon={ListChecks}
      width="md"
      title={`${item ? 'Edit' : 'New'} ${label}`}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" loading={create.isPending || update.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Sec title="Details" />
        <Field label="Name" htmlFor="ws-name" required>
          <input id="ws-name" className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        {hasColor && (
          <Field label="Color" htmlFor="ws-color">
            <div className="flex flex-wrap items-center gap-2">
              <input id="ws-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-transparent cursor-pointer" />
              {PRESETS.map((p) => (
                <button key={p} type="button" onClick={() => setColor(p)} className={cn('w-7 h-7 rounded-full border-2', p === color ? 'border-gray-900 dark:border-white' : 'border-transparent')} style={{ backgroundColor: p }} aria-label={`Use ${p}`} title={p} />
              ))}
            </div>
          </Field>
        )}
        {(kind === 'types' || kind === 'statuses') && (
          <>
            <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={isDefault} disabled={!!item?.isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
              Default for new tasks
            </label>
            <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
              {kind === 'types' ? 'Use for milestones (tasks with 0 duration)' : 'Closed status (sets the task to 100% complete)'}
            </label>
          </>
        )}
        {kind === 'types' && (
          <section>
            <Sec title="Form fields shown for this type" className="mt-4" />
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Untick fields that don&apos;t apply (e.g. hide Resources for Risk items).</p>
            <div className="grid grid-cols-2 gap-2">
              {[...OPTIONAL_TASK_FIELDS, ...taskFields.map((f) => ({ key: f._id, label: f.name }))].map((f) => {
                const on = !hiddenFields.includes(f.key);
                return (
                  <label key={f.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={on} onChange={() => setHiddenFields(on ? [...hiddenFields, f.key] : hiddenFields.filter((x) => x !== f.key))} className="w-4 h-4 accent-[var(--theme-primary)]" />
                    {f.label}
                  </label>
                );
              })}
            </div>
          </section>
        )}
        {kind === 'phases' && (
          <Field label="Gate at the end of the phase" htmlFor="ws-gate" hint="A decision point, e.g. “Plan signed off”. Leave empty for no gate.">
            <input id="ws-gate" className={inputCls} value={gate} maxLength={60} onChange={(e) => setGate(e.target.value)} />
          </Field>
        )}
        {kind === 'custom-fields' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Applies to" hint={item ? 'Cannot change after creation' : undefined}>
                <ThemedSelect
                  options={[
                    { value: 'task', label: 'Tasks' },
                    { value: 'project', label: 'Projects' },
                  ]}
                  value={scope}
                  disabled={!!item}
                  onChange={(v) => setScope(v as CustomField['scope'])}
                />
              </Field>
              <Field label="Kind" hint={item ? 'Cannot change after creation' : undefined}>
                <ThemedSelect options={FIELD_KINDS} value={fieldKind} disabled={!!item} onChange={(v) => setFieldKind(v as CustomFieldKind)} />
              </Field>
            </div>
            <Field label="Help text" htmlFor="ws-desc">
              <input id="ws-desc" className={inputCls} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
              Required (must be filled in when saving the form)
            </label>
            {(fieldKind === 'select' || fieldKind === 'multiselect') && (
              <section className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Options</p>
                {options.map((o, i) => (
                  <div key={o._id ?? `new-${i}`} className="flex gap-2">
                    <input className={inputCls} value={o.name} maxLength={60} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Option ${i + 1}`} />
                    <IconButton icon={X} label="Remove option" onClick={() => setOptions(options.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <Button inDrawer size="sm" icon={Plus} onClick={() => setOptions([...options, { name: '' }])}>
                  Add option
                </Button>
              </section>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

/** Matrix of allowed status changes per project role (owners/admins are never restricted). */
function WorkflowEditor({ data }: { data: WorkSettings }) {
  const save = useWorkflowMutation();
  const [role, setRole] = useState<'member' | 'manager'>('member');
  const [draft, setDraft] = useState<Workflow>(data.workflow ?? {});
  useEffect(() => setDraft(data.workflow ?? {}), [data.workflow]);

  const rules = draft[role];
  const restricted = !!rules;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(data.workflow ?? {}), [draft, data.workflow]);

  const toggle = (from: string, to: string) => {
    const current = rules ?? {};
    const list = current[from] ?? [];
    const next = list.includes(to) ? list.filter((x) => x !== to) : [...list, to];
    setDraft({ ...draft, [role]: { ...current, [from]: next } });
  };

  const enable = (on: boolean) => {
    if (!on) {
      const next = { ...draft };
      delete next[role];
      setDraft(next);
      return;
    }
    // Start from "everything allowed" so turning rules on changes nothing until boxes are unticked.
    const all = Object.fromEntries(data.statuses.map((s) => [s._id, data.statuses.filter((t) => t._id !== s._id).map((t) => t._id)]));
    setDraft({ ...draft, [role]: all });
  };

  return (
    <Card
      title="Status workflow"
      icon={GitMerge}
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={Save}
          disabled={!dirty}
          loading={save.isPending}
          onClick={() =>
            save.mutate(draft, {
              onSuccess: () => void toastSuccess('Workflow saved'),
              onError: (err) => void toastError(errorMessage(err)),
            })
          }
        >
          Save workflow
        </Button>
      }
    >
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Choose which status changes each project role may make. Project owners and administrators can always change any status. Viewers can never change tasks.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <FilterTabs<'member' | 'manager'>
            value={role}
            onChange={setRole}
            tabs={[
              { key: 'member', label: 'Members' },
              { key: 'manager', label: 'Managers' },
            ]}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={restricted} onChange={(e) => enable(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
            Restrict status changes for {role === 'member' ? 'members' : 'managers'}
          </label>
        </div>
        {!restricted ? (
          <Alert tone="info">{role === 'member' ? 'Members' : 'Managers'} can move tasks to any status.</Alert>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">From ↓ / To →</th>
                  {data.statuses.map((s) => (
                    <th key={s._id} className="px-2 py-2">
                      <StatusBadge status={s} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.statuses.map((from) => (
                  <tr key={from._id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-3 py-2">
                      <StatusBadge status={from} />
                    </td>
                    {data.statuses.map((to) => (
                      <td key={to._id} className="px-2 py-2 text-center">
                        {from._id === to._id ? (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={(rules?.[from._id] ?? []).includes(to._id)}
                            onChange={() => toggle(from._id, to._id)}
                            className="w-4 h-4 accent-[var(--theme-primary)]"
                            aria-label={`${role} may move from ${from.name} to ${to.name}`}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
