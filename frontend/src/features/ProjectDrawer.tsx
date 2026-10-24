'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FolderPlus, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls, Sec, textareaCls } from '@/components/ui/Field';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useCreateProject, useProjects, useUpdateProject, type CopyOptions } from '@/features/queries';
import { toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { todayISO } from '@/lib/dates';
import { KIND_LABEL, PROJECT_STATUS } from '@/lib/status';
import { can } from '@/lib/permissions';
import type { Project, ProjectKind, ProjectStatus } from '@/lib/types';

const schema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(120),
  description: z.string().max(2000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
  status: z.enum(['active', 'on_hold', 'completed', 'archived']),
  key: z.string().trim().toUpperCase().regex(/^([A-Z][A-Z0-9]{1,9})?$/, '2–10 letters/digits, starting with a letter'),
  kind: z.enum(['project', 'program', 'portfolio']),
  parent: z.string(),
  isTemplate: z.boolean(),
  fromProject: z.string(),
});
type Values = z.infer<typeof schema>;

const STATUS_OPTIONS = (Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({ value: s, label: PROJECT_STATUS[s].label }));
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as ProjectKind[]).map((k) => ({
  value: k,
  label: KIND_LABEL[k],
  description: k === 'project' ? 'A plan with tasks' : k === 'program' ? 'Groups related projects and rolls up their progress' : 'Top-level collection of programs and projects',
}));

const parentId = (p: Project['parent']) => (p && typeof p === 'object' ? p._id : p) ?? '';

/** Create a project (optionally from a template / under a parent) or edit its details. */
export function ProjectDrawer({ open, onClose, project, defaultParent }: { open: boolean; onClose: () => void; project?: Project | null; defaultParent?: string }) {
  const router = useRouter();
  const create = useCreateProject();
  const update = useUpdateProject(project?._id ?? '');
  const projects = useProjects();
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyOptions>({ tasks: true, resources: true, members: false, views: true });
  const { register, handleSubmit, control, reset, watch, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const fromProject = watch('fromProject');

  useEffect(() => {
    if (!open) return;
    setError(null);
    reset({
      name: project?.name ?? '',
      description: project?.description ?? '',
      startDate: project?.startDate ?? todayISO(),
      status: project?.status ?? 'active',
      key: project?.key ?? '',
      kind: project?.kind ?? 'project',
      parent: project ? parentId(project.parent) : defaultParent ?? '',
      isTemplate: project?.isTemplate ?? false,
      fromProject: '',
    });
  }, [open, project, defaultParent, reset]);

  /** Valid parents: projects you can edit, never the project itself or one of its descendants. */
  const parentOptions = useMemo(() => {
    const list = projects.data ?? [];
    const excluded = new Set<string>();
    if (project) {
      excluded.add(project._id);
      let grew = true;
      while (grew) {
        grew = false;
        for (const p of list) if (!excluded.has(p._id) && excluded.has(parentId(p.parent))) {
          excluded.add(p._id);
          grew = true;
        }
      }
    }
    return [
      { value: '', label: 'None (top level)' },
      ...list
        .filter((p) => !excluded.has(p._id) && !p.isTemplate && can(p, 'add_subprojects'))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'project' ? 1 : -1))
        .map((p) => ({ value: p._id, label: p.name, description: KIND_LABEL[p.kind] })),
    ];
  }, [projects.data, project]);

  const templateOptions = useMemo(
    () => [
      { value: '', label: 'Blank project' },
      ...(projects.data ?? []).filter((p) => p.isTemplate).map((p) => ({ value: p._id, label: p.name, description: `Template · ${p.stats.taskCount} tasks` })),
    ],
    [projects.data],
  );

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const { key, fromProject: source, parent, ...rest } = values;
      if (project) {
        await update.mutateAsync({ ...rest, parent: parent || null, ...(key ? { key } : {}) });
        void toastSuccess('Project updated');
        onClose();
      } else {
        const created = await create.mutateAsync({ ...rest, parent: parent || null, ...(source ? { fromProject: source, copy } : {}) });
        void toastSuccess(source ? 'Project created from template' : 'Project created');
        onClose();
        router.push(`/projects/${created._id}${values.kind === 'project' ? '' : '/overview'}`);
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
      subtitle={project ? project.name : 'Start blank or from a template'}
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
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        {error && <Alert>{error}</Alert>}
        <section>
          <Sec title="Project details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Project name" htmlFor="p-name" required error={errors.name?.message} className="sm:col-span-2">
              <input id="p-name" autoFocus className={cn(inputCls, errors.name && 'border-red-400')} placeholder="e.g. Tower B – Interior fit-out" {...register('name')} />
            </Field>
            <Field label="Type" htmlFor="p-kind">
              <Controller control={control} name="kind" render={({ field }) => <ThemedSelect id="p-kind" options={KIND_OPTIONS} value={field.value} onChange={field.onChange} />} />
            </Field>
            <Field label="Inside (parent)" htmlFor="p-parent" hint="Programs and portfolios roll up their sub-projects">
              <Controller control={control} name="parent" render={({ field }) => <ThemedSelect id="p-parent" options={parentOptions} value={field.value} searchable onChange={field.onChange} />} />
            </Field>
            <Field label="Start date" htmlFor="p-start" required error={errors.startDate?.message} hint="Nothing is scheduled before this date">
              <input id="p-start" type="date" className={inputCls} {...register('startDate')} />
            </Field>
            <Field label="Status" htmlFor="p-status" hint="Archived projects become read-only">
              <Controller control={control} name="status" render={({ field }) => <ThemedSelect id="p-status" options={STATUS_OPTIONS} value={field.value} onChange={field.onChange} />} />
            </Field>
            {project && (
              <Field label="Project key" htmlFor="p-key" error={errors.key?.message} hint={`Task IDs look like ${project.key || 'KEY'}-12`}>
                <input id="p-key" className={cn(inputCls, 'uppercase font-mono', errors.key && 'border-red-400')} maxLength={10} {...register('key')} />
              </Field>
            )}
            <Field label="Description" htmlFor="p-desc" className="sm:col-span-2">
              <textarea id="p-desc" rows={4} className={textareaCls} placeholder="Scope, goals, notes…" {...register('description')} />
            </Field>
            <label className="sm:col-span-2 flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" className="w-4 h-4 accent-[var(--theme-primary)]" {...register('isTemplate')} />
              Use as a template (everyone can start new projects from it)
            </label>
          </div>
        </section>

        {!project && (
          <section>
            <Sec title="Start from" />
            <Field label="Template" htmlFor="p-template" hint="Copies the plan, re-planned from your start date">
              <Controller control={control} name="fromProject" render={({ field }) => <ThemedSelect id="p-template" options={templateOptions} value={field.value} onChange={field.onChange} />} />
            </Field>
            {fromProject && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    ['tasks', 'Tasks & links'],
                    ['resources', 'Resources'],
                    ['views', 'Shared views'],
                    ['members', 'Team members'],
                  ] as [keyof CopyOptions, string][]
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={copy[key]} onChange={(e) => setCopy({ ...copy, [key]: e.target.checked })} className="w-4 h-4 accent-[var(--theme-primary)]" />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </section>
        )}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
