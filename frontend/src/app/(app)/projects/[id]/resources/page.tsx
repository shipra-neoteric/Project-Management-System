'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, Sec } from '@/components/ui/Field';
import { rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { usePlan, useResourceMutations, useResources, useUsers } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays, diffDays, weekday } from '@/lib/dates';
import { can } from '@/lib/permissions';
import type { Project, Resource, Task } from '@/lib/types';

/** Work days, task count and over-allocated days per resource (from the plan). */
function useWorkload(project: Project | undefined, tasks: Task[]) {
  return useMemo(() => {
    const result = new Map<string, { tasks: number; days: number; overloaded: number }>();
    if (!project) return result;
    const working = new Set(project.workingDays);
    const holidays = new Set(project.holidays);
    const perDay = new Map<string, Map<string, number>>();
    for (const t of tasks) {
      if (t.isSummary || !t.start) continue;
      for (const r of t.resources) {
        const entry = result.get(r) ?? { tasks: 0, days: 0, overloaded: 0 };
        entry.tasks += 1;
        entry.days += t.duration;
        result.set(r, entry);
        if (t.duration === 0) continue;
        const days = perDay.get(r) ?? new Map<string, number>();
        for (let i = 0; i <= diffDays(t.start, t.finish); i++) {
          const d = addDays(t.start, i);
          if (working.has(weekday(d)) && !holidays.has(d)) days.set(d, (days.get(d) ?? 0) + 1);
        }
        perDay.set(r, days);
      }
    }
    for (const [r, days] of perDay) result.get(r)!.overloaded = [...days.values()].filter((n) => n > 1).length;
    return result;
  }, [project, tasks]);
}

export default function ResourcesPage() {
  const { id } = useParams<{ id: string }>();
  const plan = usePlan(id);
  const { data: resources = [], isLoading, error } = useResources(id);
  const { remove } = useResourceMutations(id);
  const workload = useWorkload(plan.data?.project, plan.data?.tasks ?? []);
  const canEdit = can(plan.data?.project, 'manage_resources');
  const [drawer, setDrawer] = useState<{ open: boolean; resource: Resource | null }>({ open: false, resource: null });

  const onDelete = async (r: Resource) => {
    if (!(await confirmDanger(`Remove ${r.name}?`, 'They will be unassigned from every task in this project.', 'Remove'))) return;
    try {
      await remove.mutateAsync(r._id);
      void toastSuccess('Resource removed');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">People who work on this project. Assign them to tasks from the task details drawer.</p>
        {canEdit && (
          <Button variant="primary" icon={Plus} onClick={() => setDrawer({ open: true, resource: null })}>
            Add resource
          </Button>
        )}
      </div>
      {error && <Alert>{errorMessage(error)}</Alert>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : resources.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No resources yet"
            message="Add the people (or teams, vendors, equipment) that will do the work."
            action={canEdit && <Button variant="primary" icon={Plus} onClick={() => setDrawer({ open: true, resource: null })}>Add first resource</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Resource</th>
                  <th className={`${th} hidden md:table-cell`}>Email</th>
                  <th className={`${th} text-right`}>Tasks</th>
                  <th className={`${th} text-right hidden sm:table-cell`}>Work days</th>
                  <th className={th}>Workload</th>
                  <th className={`${th} text-right w-24`}>Actions</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {resources.map((r) => {
                  const w = workload.get(r._id) ?? { tasks: 0, days: 0, overloaded: 0 };
                  return (
                    <tr key={r._id} className={rowCls}>
                      <td className={td}>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{r.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{r.title || '—'}</p>
                      </td>
                      <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300`}>{r.email || '—'}</td>
                      <td className={`${td} text-right text-sm tabular-nums text-gray-900 dark:text-white`}>{w.tasks}</td>
                      <td className={`${td} text-right text-sm tabular-nums text-gray-900 dark:text-white hidden sm:table-cell`}>{w.days}</td>
                      <td className={td}>
                        {w.overloaded > 0 ? (
                          <Badge tone="danger">
                            <AlertTriangle className="w-3 h-3" /> Over-allocated {w.overloaded} day{w.overloaded === 1 ? '' : 's'}
                          </Badge>
                        ) : w.tasks > 0 ? (
                          <Badge tone="success">OK</Badge>
                        ) : (
                          <Badge>Unassigned</Badge>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        {canEdit && (
                          <div className="flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                            <IconButton icon={Pencil} label="Edit resource" tone="edit" onClick={() => setDrawer({ open: true, resource: r })} />
                            <IconButton icon={Trash2} label="Remove resource" tone="delete" onClick={() => onDelete(r)} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ResourceDrawer projectId={id} open={drawer.open} resource={drawer.resource} onClose={() => setDrawer({ open: false, resource: null })} />
    </div>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  title: z.string().max(120),
  email: z.union([z.email('Enter a valid email address'), z.literal('')]),
  user: z.string(),
});
type Values = z.infer<typeof schema>;

function ResourceDrawer({ projectId, open, resource, onClose }: { projectId: string; open: boolean; resource: Resource | null; onClose: () => void }) {
  const { create, update } = useResourceMutations(projectId);
  const users = useUsers();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, control, reset, setValue, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setError(null);
    reset({ name: resource?.name ?? '', title: resource?.title ?? '', email: resource?.email ?? '', user: resource?.user ?? '' });
  }, [open, resource, reset]);

  const userOptions = [{ value: '', label: 'Not linked' }, ...(users.data ?? []).map((u) => ({ value: u._id, label: u.name, description: u.email }))];

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const body = { ...values, user: values.user || null };
    try {
      if (resource) await update.mutateAsync({ id: resource._id, ...body });
      else await create.mutateAsync(body);
      void toastSuccess(resource ? 'Resource updated' : 'Resource added');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const errors = formState.errors;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      icon={UserPlus}
      width="md"
      title={resource ? 'Edit resource' : 'Add resource'}
      subtitle="A person, team or vendor that can be assigned to tasks"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" loading={formState.isSubmitting} onClick={onSubmit}>
            {resource ? 'Save changes' : 'Add resource'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Sec title="Details" />
        <Field label="Linked app user" htmlFor="r-user" hint="Optional: picks the name and email from a registered user">
          <Controller
            control={control}
            name="user"
            render={({ field }) => (
              <ThemedSelect
                id="r-user"
                options={userOptions}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  const u = users.data?.find((x) => x._id === v);
                  if (u) {
                    setValue('name', u.name, { shouldValidate: true });
                    setValue('email', u.email, { shouldValidate: true });
                  }
                }}
              />
            )}
          />
        </Field>
        <Field label="Name" htmlFor="r-name" required error={errors.name?.message}>
          <input id="r-name" className={cn(inputCls, errors.name && 'border-red-400')} {...register('name')} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <Field label="Job title" htmlFor="r-title">
            <input id="r-title" className={inputCls} placeholder="e.g. Site engineer" {...register('title')} />
          </Field>
          <Field label="Email" htmlFor="r-email" error={errors.email?.message}>
            <input id="r-email" type="email" className={cn(inputCls, errors.email && 'border-red-400')} {...register('email')} />
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
