'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FolderPlus, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls, Sec, textareaCls } from '@/components/ui/Field';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useCreateProject, useUpdateProject } from '@/features/queries';
import { toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { todayISO } from '@/lib/dates';
import { PROJECT_STATUS } from '@/lib/status';
import type { Project, ProjectStatus } from '@/lib/types';

const schema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(120),
  description: z.string().max(2000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
  status: z.enum(['active', 'on_hold', 'completed', 'archived']),
  key: z.string().trim().toUpperCase().regex(/^([A-Z][A-Z0-9]{1,9})?$/, '2–10 letters/digits, starting with a letter'),
});
type Values = z.infer<typeof schema>;

const STATUS_OPTIONS = (Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({ value: s, label: PROJECT_STATUS[s].label }));

/** Create a project (no `project`) or edit its details. */
export function ProjectDrawer({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project | null }) {
  const router = useRouter();
  const create = useCreateProject();
  const update = useUpdateProject(project?._id ?? '');
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, control, reset, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setError(null);
    reset({
      name: project?.name ?? '',
      description: project?.description ?? '',
      startDate: project?.startDate ?? todayISO(),
      status: project?.status ?? 'active',
      key: project?.key ?? '',
    });
  }, [open, project, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const { key, ...rest } = values;
      if (project) {
        await update.mutateAsync({ ...rest, ...(key ? { key } : {}) });
        void toastSuccess('Project updated');
        onClose();
      } else {
        const created = await create.mutateAsync(rest);
        void toastSuccess('Project created');
        onClose();
        router.push(`/projects/${created._id}`);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not save the project'));
    }
  });

  const errors = formState.errors;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      icon={project ? Pencil : FolderPlus}
      title={project ? 'Edit project' : 'New project'}
      subtitle={project ? project.name : 'Set up a project, then build its plan on the Gantt chart'}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" onClick={onSubmit} loading={formState.isSubmitting}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && <Alert className="mb-6">{error}</Alert>}
        <Sec title="Project details" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <Field label="Project name" htmlFor="p-name" required error={errors.name?.message} className="sm:col-span-2">
            <input id="p-name" autoFocus className={cn(inputCls, errors.name && 'border-red-400')} placeholder="e.g. Tower B – Interior fit-out" {...register('name')} />
          </Field>
          <Field label="Start date" htmlFor="p-start" required error={errors.startDate?.message} hint="Nothing is scheduled before this date">
            <input id="p-start" type="date" className={inputCls} {...register('startDate')} />
          </Field>
          {project && (
            <Field label="Project key" htmlFor="p-key" error={errors.key?.message} hint={`Task IDs look like ${project.key || 'KEY'}-12`}>
              <input id="p-key" className={cn(inputCls, 'uppercase font-mono', errors.key && 'border-red-400')} maxLength={10} {...register('key')} />
            </Field>
          )}
          <Field label="Status" htmlFor="p-status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => <ThemedSelect id="p-status" options={STATUS_OPTIONS} value={field.value} onChange={field.onChange} />}
            />
          </Field>
          <Field label="Description" htmlFor="p-desc" className="sm:col-span-2">
            <textarea id="p-desc" rows={4} className={textareaCls} placeholder="Scope, goals, notes…" {...register('description')} />
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
