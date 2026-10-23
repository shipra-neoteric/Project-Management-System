'use client';

import { BarChart3, Copy, LayoutGrid, ListPlus, Milestone, Plus, Save, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { CustomFieldInput, isEmptyValue } from '@/components/ui/CustomFieldInput';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useBaselines, useCopyProject, useUpdateProject, useWorkSettings, type CopyOptions } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/dates';
import { MODULE_LABELS } from '@/lib/status';
import type { GateStatus, LifecyclePhase, Project, ProjectModule, UserRef } from '@/lib/types';

async function run(fn: () => Promise<unknown>, success: string) {
  try {
    await fn();
    void toastSuccess(success);
  } catch (err) {
    void toastError(errorMessage(err));
  }
}

/** Enable/disable project modules (tabs). */
export function ModulesCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const update = useUpdateProject(project._id);
  const disabled = new Set(project.disabledModules ?? []);
  const toggle = (m: ProjectModule) => {
    const next = disabled.has(m) ? [...disabled].filter((x) => x !== m) : [...disabled, m];
    void run(() => update.mutateAsync({ disabledModules: next }), `${MODULE_LABELS[m]} ${disabled.has(m) ? 'enabled' : 'hidden'}`);
  };
  return (
    <Card title="Modules" icon={LayoutGrid}>
      <div className="p-5 space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">Hide the tabs this project doesn&apos;t need. Data is kept and comes back when you switch a module on again.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(Object.keys(MODULE_LABELS) as ProjectModule[]).map((m) => (
            <label key={m} className={cn('flex items-center gap-2 px-3 py-2 rounded-md border text-sm', disabled.has(m) ? 'border-gray-200 dark:border-gray-700 text-gray-400' : 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 text-gray-800 dark:text-gray-100')}>
              <input type="checkbox" checked={!disabled.has(m)} disabled={!canManage || update.isPending} onChange={() => toggle(m)} className="w-4 h-4 accent-[var(--theme-primary)]" />
              {MODULE_LABELS[m]}
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Project life cycle: phases with dates and gate decisions. */
export function LifecycleCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const update = useUpdateProject(project._id);
  const { data: ws } = useWorkSettings();
  const [rows, setRows] = useState<LifecyclePhase[]>(project.lifecycle ?? []);
  useEffect(() => setRows(project.lifecycle ?? []), [project.lifecycle]);
  const phases = ws?.phases ?? [];
  const byId = new Map(phases.map((p) => [p._id, p]));
  const dirty = JSON.stringify(rows) !== JSON.stringify(project.lifecycle ?? []);
  const unused = phases.filter((p) => !rows.some((r) => r.definition === p._id));
  const set = (i: number, patch: Partial<LifecyclePhase>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Card
      title="Life cycle & gates"
      icon={Milestone}
      actions={canManage && dirty && <Button size="sm" variant="primary" icon={Save} loading={update.isPending} onClick={() => run(() => update.mutateAsync({ lifecycle: rows }), 'Life cycle saved')}>Save</Button>}
    >
      <div className="p-5 space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">Plan the project&apos;s phases and record the decision at each gate. Phases are defined by your administrator.</p>
        {rows.length === 0 && <p className="text-sm text-gray-400">No phases yet.</p>}
        {rows.map((r, i) => {
          const def = byId.get(r.definition);
          return (
            <div key={r.definition} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
              <div className="col-span-12 sm:col-span-3 flex items-center gap-2 h-10">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: def?.color }} />
                <span className="text-sm font-medium text-gray-900 dark:text-white">{def?.name ?? 'Phase'}</span>
              </div>
              <Field label="Start" className="col-span-6 sm:col-span-3">
                <input type="date" className={inputCls} value={r.start ?? ''} disabled={!canManage} onChange={(e) => set(i, { start: e.target.value || null })} />
              </Field>
              <Field label="Finish" className="col-span-6 sm:col-span-3">
                <input type="date" className={inputCls} value={r.finish ?? ''} disabled={!canManage} onChange={(e) => set(i, { finish: e.target.value || null })} />
              </Field>
              <Field label={def?.gate ? `Gate: ${def.gate}` : 'Gate'} className="col-span-10 sm:col-span-2">
                <ThemedSelect
                  options={[
                    { value: 'pending', label: 'Pending' },
                    { value: 'passed', label: 'Passed' },
                    { value: 'failed', label: 'Failed' },
                  ]}
                  value={r.gateStatus}
                  disabled={!canManage || !def?.gate}
                  onChange={(v) => set(i, { gateStatus: v as GateStatus })}
                />
              </Field>
              {canManage && (
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  <IconButton icon={X} label="Remove phase" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
                </div>
              )}
            </div>
          );
        })}
        {canManage && unused.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unused.map((p) => (
              <Button key={p._id} size="sm" icon={Plus} onClick={() => setRows([...rows, { definition: p._id, start: null, finish: null, gateStatus: 'pending' }])}>
                {p.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Values of the organisation's project custom fields. */
export function AttributesCard({ project, canManage, people }: { project: Project; canManage: boolean; people: UserRef[] }) {
  const update = useUpdateProject(project._id);
  const { data: ws } = useWorkSettings();
  const fields = (ws?.customFields ?? []).filter((f) => f.scope === 'project');
  const [values, setValues] = useState<Record<string, unknown>>(project.customValues ?? {});
  useEffect(() => setValues(project.customValues ?? {}), [project.customValues]);
  if (!fields.length) return null;
  const dirty = JSON.stringify(values) !== JSON.stringify(project.customValues ?? {});

  const save = () => {
    const missing = fields.filter((f) => f.required && isEmptyValue(values[f._id])).map((f) => f.name);
    if (missing.length) return void toastError(`Please fill in: ${missing.join(', ')}`);
    void run(() => update.mutateAsync({ customValues: Object.fromEntries(fields.map((f) => [f._id, isEmptyValue(values[f._id]) ? null : values[f._id]])) }), 'Attributes saved');
  };

  return (
    <Card title="Project attributes" icon={ListPlus} actions={canManage && dirty && <Button size="sm" variant="primary" icon={Save} loading={update.isPending} onClick={save}>Save</Button>}>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {fields.map((f) => (
          <Field key={f._id} label={f.name} htmlFor={`cf-${f._id}`} required={f.required} hint={f.description || undefined} className={f.kind === 'longtext' || f.kind === 'multiselect' ? 'sm:col-span-2' : undefined}>
            <CustomFieldInput field={f} value={values[f._id]} people={people} disabled={!canManage} onChange={(v) => setValues({ ...values, [f._id]: v })} />
          </Field>
        ))}
      </div>
    </Card>
  );
}

/** Several named baselines; the newest is the one drawn on the Gantt by default. */
export function BaselinesCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const baselines = useBaselines(project._id);
  const [name, setName] = useState('');
  return (
    <Card title="Baselines" icon={BarChart3}>
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          A baseline is a snapshot of the plan. Save one at approval and after each re-plan, then pick any of them on the Gantt chart to see slippage.
        </p>
        {canManage && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => baselines.create.mutateAsync(name.trim() || `Baseline ${todayISO()}`), 'Baseline saved').then(() => setName(''));
            }}
          >
            <input className={inputCls} value={name} maxLength={80} placeholder={`e.g. Approved plan (${fmtDate(todayISO())})`} onChange={(e) => setName(e.target.value)} aria-label="Baseline name" />
            <Button type="submit" variant="primary" icon={Plus} loading={baselines.create.isPending}>
              Save baseline
            </Button>
          </form>
        )}
        {!baselines.data?.length ? (
          <Alert tone="info">No baselines saved yet.</Alert>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
            {baselines.data.map((b, i) => (
              <li key={b._id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {b.name} {i === 0 && <Badge tone="info">Latest</Badge>}
                  </p>
                  <p className="text-xs text-gray-500">
                    Planned finish {fmtDate(b.finishDate)} · saved {fmtDateTime(b.createdAt)} by {b.createdBy?.name ?? '—'}
                  </p>
                </div>
                {canManage && (
                  <IconButton
                    icon={Trash2}
                    label="Delete baseline"
                    tone="delete"
                    onClick={async () => {
                      if (await confirmDanger(`Delete the baseline "${b.name}"?`)) await run(() => baselines.remove.mutateAsync(b._id), 'Baseline deleted');
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Copy this project, or save it as a reusable template. */
export function CopyCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const router = useRouter();
  const copyProject = useCopyProject(project._id);
  const [name, setName] = useState(`${project.name} (copy)`);
  const [startDate, setStartDate] = useState(todayISO());
  const [asTemplate, setAsTemplate] = useState(false);
  const [opts, setOpts] = useState<CopyOptions>({ tasks: true, resources: true, members: true, views: true });
  if (!canManage && !project.isTemplate) return null;

  return (
    <Card title={project.isTemplate ? 'Use this template' : 'Copy project'} icon={Copy}>
      <form
        className="p-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            try {
              const created = await copyProject.mutateAsync({ name: name.trim(), startDate, isTemplate: asTemplate, copy: opts });
              void toastSuccess(asTemplate ? 'Template created' : 'Project copied');
              router.push(`/projects/${created._id}`);
            } catch (err) {
              void toastError(errorMessage(err));
            }
          })();
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="New name" htmlFor="cp-name" required>
            <input id="cp-name" className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Start date" htmlFor="cp-start" required hint="Fixed dates move with the start">
            <input id="cp-start" type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['tasks', 'Tasks & links'],
              ['resources', 'Resources'],
              ['views', 'Shared views'],
              ['members', 'Team members'],
            ] as [keyof CopyOptions, string][]
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} className="w-4 h-4 accent-[var(--theme-primary)]" />
              {label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={asTemplate} onChange={(e) => setAsTemplate(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
          Save the copy as a template
        </label>
        <Button type="submit" variant="primary" icon={Copy} disabled={!name.trim() || !startDate} loading={copyProject.isPending}>
          {project.isTemplate ? 'Create project from template' : 'Copy project'}
        </Button>
      </form>
    </Card>
  );
}
