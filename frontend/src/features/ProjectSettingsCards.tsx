'use client';

import { BarChart3, Copy, Gauge, Coins, LayoutGrid, ListPlus, Milestone, Plus, Save, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { CustomFieldInput, isEmptyValue } from '@/components/ui/CustomFieldInput';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useBaselines, useCopyProject, useProjectRates, useUpdateProject, useWorkSettings, type CopyOptions } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/dates';
import { useMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { MODULE_LABELS } from '@/lib/status';
import type { GateStatus, HourlyRate, LifecyclePhase, ProgressMode, Project, ProjectModule, UserRef } from '@/lib/types';

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

const PROGRESS_MODES: { value: ProgressMode; title: string; text: string }[] = [
  { value: 'manual', title: 'Manual', text: 'People type in % complete on each task' },
  { value: 'work', title: 'Work-based', text: '% complete = (work − remaining work) ÷ work' },
  { value: 'status', title: 'Status-based', text: 'Each status sets a % complete (Work settings → Statuses)' },
];

/** How task % complete is calculated in this project. */
export function ProgressModeCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const update = useUpdateProject(project._id);
  const mode = project.progressMode ?? 'manual';
  const choose = (value: ProgressMode) => {
    if (value === mode) return;
    // progressMode is accepted by the API but not part of the shared mutation type.
    void run(() => update.mutateAsync({ progressMode: value } as Parameters<typeof update.mutateAsync>[0]), 'Progress calculation updated');
  };
  return (
    <Card title="Progress calculation" icon={Gauge}>
      <div className="p-5 space-y-2">
        {PROGRESS_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            disabled={!canManage || update.isPending}
            onClick={() => choose(m.value)}
            aria-pressed={mode === m.value}
            className={cn(
              'w-full text-left px-3 py-2 rounded-md border transition-colors disabled:cursor-not-allowed',
              mode === m.value ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50',
            )}
          >
            <span className="block text-sm font-medium text-gray-900 dark:text-white">{m.title}</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">{m.text}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

/** Hourly rates that override people's default rates in this project. */
export function ProjectRatesCard({ project, people }: { project: Project; people: UserRef[] }) {
  const canView = can(project, 'view_costs');
  const canEdit = can(project, 'manage_rates');
  const rates = useProjectRates(project._id, canView);
  const { money } = useMoney();
  const [userId, setUserId] = useState('');
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState(todayISO());
  if (!canView) return null;

  const add = () => {
    const value = Number(rate);
    if (!userId || Number.isNaN(value) || value < 0) return void toastError('Choose a person and enter a rate');
    void run(
      () => rates.set.mutateAsync({ user: userId, rate: value, validFrom }).then(() => setRate('')),
      'Rate saved — time entries were re-priced',
    );
  };
  const list = rates.data ?? [];
  const nameOf = (u: HourlyRate['user']) => (typeof u === 'object' ? u.name : people.find((p) => p._id === u)?.name ?? 'Former member');

  return (
    <Card title="Project hourly rates" icon={Coins}>
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">Override a person&apos;s default hourly rate for work in this project. Labour costs use the rate valid on the day the time was logged.</p>
        {canEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_150px_auto] gap-2 items-end">
            <Field label="Person">
              <ThemedSelect options={people.map((p) => ({ value: p._id, label: p.name }))} value={userId} onChange={setUserId} placeholder="Choose…" searchable />
            </Field>
            <Field label="Rate / hour" htmlFor="pr-rate">
              <input id="pr-rate" type="number" min={0} step={0.01} className={inputCls} value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Field label="Valid from" htmlFor="pr-from">
              <input id="pr-from" type="date" className={inputCls} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Button icon={Plus} loading={rates.set.isPending} disabled={!userId || rate === ''} onClick={add}>
              Add
            </Button>
          </div>
        )}
        {list.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No project rates — everyone&apos;s default rate applies.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
            {list.map((r) => (
              <li key={r._id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-white">{nameOf(r.user)}</span>
                <span className="text-gray-500 dark:text-gray-400 tabular-nums">from {fmtDate(r.validFrom)}</span>
                <span className="w-28 text-right font-medium text-gray-900 dark:text-white tabular-nums">{money(r.rate)}/h</span>
                {canEdit && (
                  <IconButton
                    icon={Trash2}
                    label="Delete rate"
                    tone="delete"
                    onClick={async () => {
                      if (await confirmDanger('Delete this rate?', 'Time entries will be re-priced with the remaining rates.')) void run(() => rates.remove.mutateAsync(r._id), 'Rate deleted');
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
