'use client';

import { ChevronDown, ChevronUp, CircleDot, ListChecks, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, Sec } from '@/components/ui/Field';
import { Card, Page, PageHeader, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { StatusBadge, TypeLabel } from '@/components/ui/TaskBits';
import { AdminGate } from '@/features/AdminGate';
import { useWorkSettings, useWorkSettingsMutations } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Status, TaskType } from '@/lib/types';

type Kind = 'types' | 'statuses';
type Item = (TaskType | Status) & { isClosed?: boolean; isMilestone?: boolean };
const PRESETS = ['#6b7280', '#3b82f6', '#22c55e', '#14b8a6', '#a855f7', '#8b5cf6', '#f59e0b', '#f97316', '#ef4444', '#ec4899'];

export default function WorkSettingsPage() {
  return (
    <AdminGate>
      <WorkSettingsContent />
    </AdminGate>
  );
}

function WorkSettingsContent() {
  const { data, isLoading, error } = useWorkSettings();
  const { remove, update } = useWorkSettingsMutations();
  const [editing, setEditing] = useState<{ kind: Kind; item: Item | null } | null>(null);

  if (isLoading) return <PageLoader />;
  if (error || !data) return <Alert>{errorMessage(error)}</Alert>;

  const onDelete = async (kind: Kind, item: Item) => {
    if (!(await confirmDanger(`Delete "${item.name}"?`, 'Only possible when no task uses it.'))) return;
    try {
      await remove.mutateAsync({ kind, id: item._id });
      void toastSuccess('Deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const reorder = async (kind: Kind, list: Item[], index: number, delta: number) => {
    const other = list[index + delta];
    if (!other) return;
    try {
      await update.mutateAsync({ kind, id: list[index]._id, body: { position: other.position } });
      await update.mutateAsync({ kind, id: other._id, body: { position: list[index].position === other.position ? other.position + delta : list[index].position } });
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const section = (kind: Kind, list: Item[]) => (
    <Card
      title={kind === 'types' ? 'Task types' : 'Statuses'}
      icon={kind === 'types' ? Tags : CircleDot}
      actions={
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing({ kind, item: null })}>
          Add
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className={tableCls}>
          <thead className={theadCls}>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Flags</th>
              <th className={`${th} text-right w-36`}>Actions</th>
            </tr>
          </thead>
          <tbody className={tbodyCls}>
            {list.map((item, i) => (
              <tr key={item._id} className={rowCls}>
                <td className={td}>{kind === 'types' ? <TypeLabel type={item as TaskType} className="text-xs" /> : <StatusBadge status={item as Status} />}</td>
                <td className={`${td} space-x-1`}>
                  {item.isDefault && <Badge tone="info">Default</Badge>}
                  {item.isClosed && <Badge tone="success">Closed</Badge>}
                  {item.isMilestone && <Badge tone="purple">Milestones</Badge>}
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <div className="flex items-center justify-end gap-1">
                    <IconButton icon={ChevronUp} label="Move up" disabled={i === 0} onClick={() => reorder(kind, list, i, -1)} />
                    <IconButton icon={ChevronDown} label="Move down" disabled={i === list.length - 1} onClick={() => reorder(kind, list, i, 1)} />
                    <IconButton icon={Pencil} label="Edit" tone="edit" onClick={() => setEditing({ kind, item })} />
                    {!item.isDefault && <IconButton icon={Trash2} label="Delete" tone="delete" onClick={() => onDelete(kind, item)} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <Page>
      <PageHeader title="Types & statuses" subtitle="Organisation-wide task types and statuses used by every project" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        {section('types', data.types)}
        {section('statuses', data.statuses)}
      </div>
      <ItemDrawer state={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function ItemDrawer({ state, onClose }: { state: { kind: Kind; item: Item | null } | null; onClose: () => void }) {
  const { create, update } = useWorkSettingsMutations();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESETS[1]);
  const [isDefault, setIsDefault] = useState(false);
  const [flag, setFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setError(null);
    setName(state.item?.name ?? '');
    setColor(state.item?.color ?? PRESETS[1]);
    setIsDefault(!!state.item?.isDefault);
    setFlag(state.kind === 'types' ? !!state.item?.isMilestone : !!state.item?.isClosed);
  }, [state]);

  if (!state) return null;
  const isType = state.kind === 'types';
  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('Name is required');
    const body = { name: name.trim(), color, ...(isDefault ? { isDefault: true } : {}), ...(isType ? { isMilestone: flag } : { isClosed: flag }) };
    try {
      if (state.item) await update.mutateAsync({ kind: state.kind, id: state.item._id, body });
      else await create.mutateAsync({ kind: state.kind, body });
      void toastSuccess('Saved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={ListChecks}
      width="md"
      title={`${state.item ? 'Edit' : 'New'} ${isType ? 'type' : 'status'}`}
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
          <input id="ws-name" className={inputCls} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Color" htmlFor="ws-color">
          <div className="flex flex-wrap items-center gap-2">
            <input id="ws-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-transparent cursor-pointer" />
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setColor(p)}
                className={cn('w-7 h-7 rounded-full border-2', p === color ? 'border-gray-900 dark:border-white' : 'border-transparent')}
                style={{ backgroundColor: p }}
                aria-label={`Use ${p}`}
                title={p}
              />
            ))}
          </div>
        </Field>
        <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={isDefault} disabled={!!state.item?.isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
          Default for new tasks
        </label>
        <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
          {isType ? 'Use for milestones (tasks with 0 duration)' : 'Closed status (sets the task to 100% complete)'}
        </label>
        <div className="pt-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Preview</p>
          {isType ? <TypeLabel type={{ _id: '', name: name || 'Type', color, position: 0, isDefault, isMilestone: flag }} className="text-sm" /> : <StatusBadge status={{ _id: '', name: name || 'Status', color, position: 0, isDefault, isClosed: flag }} />}
        </div>
      </div>
    </Drawer>
  );
}
