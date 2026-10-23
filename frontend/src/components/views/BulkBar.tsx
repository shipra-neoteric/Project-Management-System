'use client';

import { Copy, FolderInput, Trash2, X } from 'lucide-react';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useWorkspace } from '@/features/project-context';
import { useProjects, useTaskMutations, type TaskAttributes } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { FIELD_MAP } from '@/lib/query';
import { atLeast } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import type { Priority } from '@/lib/types';

const BULK_FIELDS = ['status', 'type', 'priority', 'assignee', 'category'] as const;

/** Bulk actions for selected tasks (Nexora §7.4 bulk actions bar). */
export function BulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const { projectId, ctx, canEdit } = useWorkspace();
  const { bulk, bulkDelete, transfer } = useTaskMutations(projectId);
  const projects = useProjects();
  const { themeColor } = useTheme();
  if (!selected.length || !ctx || !canEdit) return null;

  const run = async (fn: () => Promise<unknown>, message: string, clear = false) => {
    try {
      await fn();
      void toastSuccess(message);
      if (clear) onClear();
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const setField = (field: (typeof BULK_FIELDS)[number], value: string) => {
    const patch: TaskAttributes =
      field === 'priority' ? { priority: value as Priority } : field === 'status' || field === 'type' ? { [field]: value } : { [field]: value || null };
    void run(() => bulk.mutateAsync({ taskIds: selected, patch }), `Updated ${selected.length} task${selected.length === 1 ? '' : 's'}`);
  };

  const transferTo = async (mode: 'copy' | 'move') => {
    const targets = (projects.data ?? []).filter((p) => atLeast(p.myRole, 'member') && (mode === 'copy' || p._id !== projectId));
    if (!targets.length) return void toastError('There is no other project you can edit');
    const Swal = (await import('sweetalert2')).default;
    const result = await Swal.fire({
      title: mode === 'copy' ? 'Copy tasks to…' : 'Move tasks to…',
      text: `${selected.length} task${selected.length === 1 ? '' : 's'} (sub-tasks included). Links between them are kept.`,
      input: 'select',
      inputOptions: Object.fromEntries(targets.map((p) => [p._id, p._id === projectId ? `${p.name} (this project)` : p.name])),
      inputValue: mode === 'copy' ? projectId : targets[0]._id,
      showCancelButton: true,
      confirmButtonText: mode === 'copy' ? 'Copy' : 'Move',
      confirmButtonColor: themeColor,
    });
    if (!result.isConfirmed) return;
    await run(
      () => transfer.mutateAsync({ taskIds: selected, targetProjectId: String(result.value), mode }),
      mode === 'copy' ? 'Tasks copied' : 'Tasks moved',
      true,
    );
  };

  const remove = async () => {
    if (!(await confirmDanger(`Delete ${selected.length} task${selected.length === 1 ? '' : 's'}?`, 'Sub-tasks of selected summary tasks are deleted too.'))) return;
    await run(() => bulkDelete.mutateAsync(selected), 'Tasks deleted', true);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg no-print animate-fade-in-down">
      <span className="text-sm font-medium text-blue-700 dark:text-blue-400 mr-1">{selected.length} selected</span>
      {BULK_FIELDS.map((field) => {
        const def = FIELD_MAP.get(field)!;
        const options = [...(def.options?.(ctx) ?? []), ...(field === 'assignee' || field === 'category' ? [{ value: '', label: `No ${def.label.toLowerCase()}` }] : [])];
        if (field === 'category' && options.length <= 1) return null;
        return (
          <div key={field} className="w-36">
            <ThemedSelect compact options={options} value={null} placeholder={`Set ${def.label.toLowerCase()}…`} onChange={(v) => setField(field, v)} searchable={options.length > 8} />
          </div>
        );
      })}
      <button type="button" onClick={() => transferTo('copy')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-medium transition-colors">
        <Copy className="w-3.5 h-3.5" /> Copy to…
      </button>
      <button type="button" onClick={() => transferTo('move')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-medium transition-colors">
        <FolderInput className="w-3.5 h-3.5" /> Move to…
      </button>
      <button type="button" onClick={remove} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors">
        <Trash2 className="w-3.5 h-3.5" /> Delete
      </button>
      <button type="button" onClick={onClear} className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Clear selection" title="Clear selection">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
