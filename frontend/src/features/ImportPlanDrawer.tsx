'use client';

import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, FileUp, FolderPlus, Link2, Milestone, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls, Sec } from '@/components/ui/Field';
import { FilterTabs, tableCls, tbodyCls, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { keys, useProjects } from '@/features/queries';
import { toastError } from '@/lib/alerts';
import { api, apiUpload, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { todayISO } from '@/lib/dates';
import { guessColumns, IMPORT_FIELDS, readSheet, rowsFromSheet, SAMPLE_CSV, type Cell, type ColumnMap, type ImportField, type ImportRow } from '@/lib/importParse';
import { can } from '@/lib/permissions';
import { useTheme } from '@/lib/theme';

type Step = 'file' | 'map' | 'preview' | 'result';

interface ImportResult {
  projectId: string;
  projectName: string;
  createdProject: boolean;
  tasks: number;
  summaries: number;
  milestones: number;
  links: number;
  resourcesCreated: number;
  assigned: number;
  warnings: string[];
}

const th = 'px-3 py-2 text-left text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap';
const td = 'px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap';

function downloadSample() {
  const url = URL.createObjectURL(new Blob([`﻿${SAMPLE_CSV}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plan-import-template.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Import wizard: upload an MS Project XML, Excel or CSV plan → map columns (spreadsheets) →
 * preview → import into a new project or (with `projectId`) the current one.
 */
export function ImportPlanDrawer({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
  const { themeColor } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const projects = useProjects();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  // Spreadsheet state
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<Cell[][]>([]);
  const [map, setMap] = useState<ColumnMap>({});
  const [dayFirst, setDayFirst] = useState(true);
  // Parsed plan
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Target and options
  const [target, setTarget] = useState<'new' | 'existing'>(projectId ? 'existing' : 'new');
  const [existingId, setExistingId] = useState(projectId ?? '');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [parent, setParent] = useState('');
  const [matchPeople, setMatchPeople] = useState(true);
  const [createResources, setCreateResources] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setStep('file');
    setError(null);
    setFileName('');
    setRows([]);
    setWarnings([]);
    setResult(null);
    setHeaders([]);
    setSheetRows([]);
  };
  const close = () => {
    reset();
    onClose();
  };

  const editable = useMemo(() => (projects.data ?? []).filter((p) => p.kind === 'project' && !p.isTemplate && can(p, 'edit_tasks')), [projects.data]);
  const parents = useMemo(() => (projects.data ?? []).filter((p) => !p.isTemplate && can(p, 'add_subprojects')), [projects.data]);

  const applyPlan = (planRows: ImportRow[], planWarnings: string[], planName: string, planStart: string | null) => {
    setRows(planRows);
    setWarnings(planWarnings);
    if (!name) setName(planName);
    const earliest = planRows.map((r) => r.start).filter((d): d is string => !!d).sort()[0];
    setStartDate(planStart ?? earliest ?? todayISO());
    setStep('preview');
  };

  const onFile = async (file: File) => {
    setError(null);
    setFileName(file.name);
    setBusy(true);
    try {
      if (/\.xml$/i.test(file.name)) {
        const parsed = await apiUpload<{ name: string; startDate: string | null; rows: ImportRow[]; warnings: string[] }>('/import/msproject/preview', file);
        applyPlan(parsed.rows, parsed.warnings, parsed.name, parsed.startDate);
      } else if (/\.(xlsx|csv|txt)$/i.test(file.name)) {
        const sheet = await readSheet(file);
        setHeaders(sheet.headers);
        setSheetRows(sheet.rows);
        setMap(guessColumns(sheet.headers));
        setName(file.name.replace(/\.(xlsx|csv|txt)$/i, '').replace(/[_-]+/g, ' ').trim());
        setStep('map');
      } else {
        throw new Error('Choose an MS Project XML (.xml), Excel (.xlsx) or CSV file. Save .mpp files as XML from MS Project first.');
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not read the file'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyMapping = () => {
    if (map.name === undefined) return setError('Choose the column that holds the task names');
    setError(null);
    const parsed = rowsFromSheet(sheetRows, map, { dayFirst });
    if (!parsed.rows.length) return setError(parsed.warnings[0] ?? 'No tasks found');
    applyPlan(parsed.rows, parsed.warnings, name, null);
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        target === 'existing'
          ? { projectId: existingId, rows, options: { matchPeople, createResources } }
          : { newProject: { name: name.trim(), startDate, parent: parent || null }, rows, options: { matchPeople, createResources } };
      const res = await api<ImportResult>('/import/commit', { method: 'POST', body });
      setResult(res);
      setStep('result');
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: keys.plan(res.projectId) });
      void qc.invalidateQueries({ queryKey: keys.resources(res.projectId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    } catch (err) {
      setError(errorMessage(err, 'The import failed'));
      void toastError('The import failed');
    } finally {
      setBusy(false);
    }
  };

  const parentKeys = useMemo(() => new Set(rows.filter((r, i) => (rows[i + 1]?.level ?? 0) > r.level).map((r) => r.key)), [rows]);
  const stats = {
    tasks: rows.length,
    summaries: parentKeys.size,
    milestones: rows.filter((r) => !parentKeys.has(r.key) && (r.milestone || r.duration === 0)).length,
    links: rows.reduce((a, r) => a + r.predecessors.length, 0),
  };
  const canCommit = rows.length > 0 && (target === 'existing' ? !!existingId : name.trim().length > 0 && !!startDate);

  const footer =
    step === 'file' ? (
      <Button variant="secondary" inDrawer onClick={close}>
        Cancel
      </Button>
    ) : step === 'map' ? (
      <>
        <Button variant="secondary" inDrawer icon={ArrowLeft} onClick={reset}>
          Back
        </Button>
        <Button variant="primary" inDrawer onClick={applyMapping} disabled={map.name === undefined}>
          Preview {sheetRows.length} rows
        </Button>
      </>
    ) : step === 'preview' ? (
      <>
        <Button variant="secondary" inDrawer icon={ArrowLeft} onClick={() => (headers.length ? setStep('map') : reset())}>
          Back
        </Button>
        <Button variant="primary" inDrawer icon={Upload} loading={busy} disabled={!canCommit} onClick={commit}>
          Import {rows.length} task{rows.length === 1 ? '' : 's'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" inDrawer onClick={close}>
          Close
        </Button>
        {result && (
          <Button
            variant="primary"
            inDrawer
            onClick={() => {
              close();
              router.push(`/projects/${result.projectId}`);
            }}
          >
            Open {result.projectName}
          </Button>
        )}
      </>
    );

  const stepsLabel = ['Upload', headers.length ? 'Map columns' : null, 'Preview', 'Done'].filter(Boolean) as string[];
  const stepIndex = step === 'file' ? 0 : step === 'map' ? 1 : step === 'preview' ? (headers.length ? 2 : 1) : stepsLabel.length - 1;

  return (
    <Drawer open={open} onClose={close} title="Import a plan" subtitle="MS Project XML, Excel or CSV" icon={FileUp} width="lg" footer={footer}>
      <ol className="flex items-center gap-2 mb-6 text-xs" aria-label="Import steps">
        {stepsLabel.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn('w-6 h-6 rounded-full flex items-center justify-center font-semibold', i <= stepIndex ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400')}
              style={i <= stepIndex ? { backgroundColor: themeColor } : undefined}
            >
              {i + 1}
            </span>
            <span className={cn(i === stepIndex ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400')}>{label}</span>
            {i < stepsLabel.length - 1 && <span className="w-6 h-px bg-gray-200 dark:bg-gray-700" />}
          </li>
        ))}
      </ol>

      {error && <Alert className="mb-4">{error}</Alert>}

      {step === 'file' && (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onFile(f);
            }}
            disabled={busy}
            className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-6 py-12 flex flex-col items-center gap-3 text-center hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
          >
            <FileUp className="w-10 h-10 text-gray-400" />
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{busy ? `Reading ${fileName}…` : 'Drop a file here or click to choose'}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">MS Project .xml · Excel .xlsx · .csv — up to 10 MB and {2000} tasks</span>
          </button>
          <input ref={fileRef} type="file" accept=".xml,.xlsx,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-2">
            <p className="font-medium text-gray-800 dark:text-gray-100">From MS Project</p>
            <p>Open the plan, then File → Save As → choose <span className="font-medium">XML Format (*.xml)</span>. Tasks, outline, durations, links with lag, % complete, notes, work and resources are imported.</p>
            <p className="font-medium text-gray-800 dark:text-gray-100 pt-1">From Excel</p>
            <p>One task per row with a header row. You map the columns in the next step.</p>
            <button type="button" onClick={downloadSample} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
              <Download className="w-3.5 h-3.5" /> Download a sample CSV template
            </button>
          </div>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <FileSpreadsheet className="inline w-4 h-4 mr-1 text-green-600" />
            {fileName}: {sheetRows.length} rows, {headers.length} columns. Match each field to a column; unmatched fields are left empty.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} required={'required' in f} hint={'hint' in f ? f.hint : undefined}>
                <ThemedSelect
                  compact
                  options={[{ value: '', label: '— Not in the file —' }, ...headers.map((h, i) => ({ value: String(i), label: h, description: sampleOf(sheetRows, i) }))]}
                  value={map[f.key as ImportField] === undefined ? '' : String(map[f.key as ImportField])}
                  onChange={(v) => setMap((m) => ({ ...m, [f.key]: v === '' ? undefined : Number(v) }))}
                />
              </Field>
            ))}
          </div>
          <Field label="Date format" hint="How dates like 02/11/2026 should be read">
            <ThemedSelect
              compact
              options={[
                { value: 'dmy', label: 'Day first — 02/11/2026 is 2 November' },
                { value: 'mdy', label: 'Month first — 02/11/2026 is 11 February' },
              ]}
              value={dayFirst ? 'dmy' : 'mdy'}
              onChange={(v) => setDayFirst(v === 'dmy')}
            />
          </Field>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Tasks', value: stats.tasks, icon: FileUp },
              { label: 'Summary tasks', value: stats.summaries, icon: FolderPlus },
              { label: 'Milestones', value: stats.milestones, icon: Milestone },
              { label: 'Links', value: stats.links, icon: Link2 },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-gray-100 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <k.icon className="w-3.5 h-3.5" /> {k.label}
                </p>
                <p className="text-xl font-medium text-gray-900 dark:text-white tabular-nums mt-1">{k.value}</p>
              </div>
            ))}
          </div>

          {warnings.length > 0 && (
            <Alert tone="warning">
              <ul className="list-disc pl-4 space-y-0.5">
                {warnings.slice(0, 8).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}
              </ul>
            </Alert>
          )}

          <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-auto max-h-80 custom-scrollbar">
            <table className={tableCls}>
              <thead className={cn(theadCls, 'sticky top-0')}>
                <tr>
                  <th className={th}>ID</th>
                  <th className={th}>Task</th>
                  <th className={`${th} text-right`}>Days</th>
                  <th className={th}>Start</th>
                  <th className={`${th} text-right`}>%</th>
                  <th className={th}>Predecessors</th>
                  <th className={th}>Assignee / resources</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {rows.slice(0, 150).map((r) => (
                  <tr key={`${r.key}-${r.name}`}>
                    <td className={`${td} text-gray-400`}>{r.key}</td>
                    <td className={cn(td, 'max-w-xs truncate', parentKeys.has(r.key) && 'font-semibold text-gray-900 dark:text-white')} style={{ paddingLeft: `${0.75 + (r.level - 1) * 1}rem` }}>
                      {r.name}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{parentKeys.has(r.key) ? '—' : r.duration === 0 ? '◆' : r.duration}</td>
                    <td className={td}>{r.start ?? ''}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.percentComplete || ''}</td>
                    <td className={td}>{r.predecessors.map((p) => `${p.key}${p.type === 'FS' ? '' : p.type}${p.lag ? `${p.lag > 0 ? '+' : ''}${p.lag}d` : ''}`).join(', ')}</td>
                    <td className={`${td} max-w-[12rem] truncate`}>{[r.assignee, ...r.resources.filter((x) => x !== r.assignee)].filter(Boolean).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 150 && <p className="px-3 py-2 text-xs text-gray-400">Showing the first 150 of {rows.length} tasks.</p>}
          </div>

          <div>
            <Sec title="Import into" icon={FolderPlus} />
            {!projectId && (
              <div className="mb-4">
                <FilterTabs<'new' | 'existing'>
                  value={target}
                  onChange={setTarget}
                  tabs={[
                    { key: 'new', label: 'A new project' },
                    { key: 'existing', label: 'An existing project' },
                  ]}
                />
              </div>
            )}
            {target === 'new' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Project name" htmlFor="imp-name" required>
                  <input id="imp-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </Field>
                <Field label="Project start" htmlFor="imp-start" required hint="Tasks without links start here">
                  <input id="imp-start" type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label="Part of (optional)" className="sm:col-span-2">
                  <ThemedSelect
                    options={[{ value: '', label: 'None (top level)' }, ...parents.map((p) => ({ value: p._id, label: p.name }))]}
                    value={parent}
                    onChange={setParent}
                    searchable
                  />
                </Field>
              </div>
            ) : projectId ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">The tasks are added at the end of this project’s plan.</p>
            ) : (
              <Field label="Project" hint="Tasks are added at the end of the plan">
                <ThemedSelect options={editable.map((p) => ({ value: p._id, label: p.name }))} value={existingId} onChange={setExistingId} placeholder="Choose a project…" searchable />
              </Field>
            )}
          </div>

          <div className="space-y-2">
            <Sec title="Options" />
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="mt-0.5 rounded" checked={matchPeople} onChange={(e) => setMatchPeople(e.target.checked)} />
              <span>Assign tasks to project members whose name or email matches the assignee / first resource</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="mt-0.5 rounded" checked={createResources} onChange={(e) => setCreateResources(e.target.checked)} />
              <span>Create resources that don’t exist in the project yet</span>
            </label>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center gap-2 py-6">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {result.tasks} task{result.tasks === 1 ? '' : 's'} imported into {result.projectName}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {result.summaries} summary · {result.milestones} milestones · {result.links} links · {result.assigned} assigned · {result.resourcesCreated} new resources
            </p>
          </div>
          {result.warnings.length > 0 && (
            <Alert tone="warning">
              <p className="font-medium mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Check these
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** First non-empty value of a column, shown next to the column name while mapping. */
function sampleOf(rows: Cell[][], i: number) {
  const v = rows.find((r) => r[i] !== null && r[i] !== undefined && String(r[i]).trim() !== '')?.[i];
  if (v === undefined || v === null) return undefined;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return `e.g. ${s.length > 30 ? `${s.slice(0, 30)}…` : s}`;
}

/** Toolbar button that opens the import wizard for the current project. */
export function ImportPlanButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={FileUp} onClick={() => setOpen(true)} title="Import tasks from MS Project, Excel or CSV">
        Import
      </Button>
      <ImportPlanDrawer open={open} onClose={() => setOpen(false)} projectId={projectId} />
    </>
  );
}
