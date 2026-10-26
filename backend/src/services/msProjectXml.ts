import { XMLParser } from 'fast-xml-parser';
import { isISODate } from '../scheduling/calendar';
import { badRequest } from '../utils/http';
import { MAX_IMPORT_ROWS, type ImportRow } from './planImport';

/** MS Project PredecessorLink Type → our link type. */
const LINK_TYPE: Record<number, ImportRow['predecessors'][number]['type']> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };

export interface ParsedMsProject {
  name: string;
  startDate: string | null;
  rows: ImportRow[];
  warnings: string[];
}

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const date = (v: unknown) => {
  const d = text(v).slice(0, 10);
  return isISODate(d) ? d : null;
};

/** "PT16H0M0S" / "P1DT4H" → minutes (a "D" counts as one working day). */
export function durationMinutes(value: unknown, minutesPerDay: number): number {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text(value));
  if (!m) return 0;
  return num(m[1]) * minutesPerDay + num(m[2]) * 60 + num(m[3]) + num(m[4]) / 60;
}

/** Parses an MS Project XML export (File → Save As → XML) into import rows. */
export function parseMsProjectXml(xml: string): ParsedMsProject {
  // Entity declarations are never needed in MS Project files; refusing them blocks entity-expansion attacks.
  if (/<!ENTITY/i.test(xml)) throw badRequest('This XML file contains entity declarations and cannot be imported');
  let doc: Record<string, unknown>;
  try {
    doc = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      trimValues: true,
      isArray: (name) => ['Task', 'PredecessorLink', 'Resource', 'Assignment'].includes(name),
    }).parse(xml) as Record<string, unknown>;
  } catch {
    throw badRequest('This is not a valid XML file');
  }
  const project = doc.Project as Record<string, unknown> | undefined;
  const tasks = ((project?.Tasks as { Task?: Record<string, unknown>[] } | undefined)?.Task ?? []) as Record<string, unknown>[];
  if (!project || !tasks.length) throw badRequest('No tasks found. Export the plan from MS Project with File → Save As → XML.');

  const minutesPerDay = num(project.MinutesPerDay, 480) || 480;
  const warnings: string[] = [];

  // Resources and assignments: resource names per task; the first one is also tried as the assignee.
  const resources = new Map<string, { name: string; email: string }>();
  for (const r of ((project.Resources as { Resource?: Record<string, unknown>[] } | undefined)?.Resource ?? []) as Record<string, unknown>[]) {
    const uid = text(r.UID);
    const name = text(r.Name);
    if (!uid || uid === '0' || !name) continue;
    resources.set(uid, { name, email: text(r.EmailAddress) });
  }
  const byTask = new Map<string, string[]>();
  for (const a of ((project.Assignments as { Assignment?: Record<string, unknown>[] } | undefined)?.Assignment ?? []) as Record<string, unknown>[]) {
    const r = resources.get(text(a.ResourceUID));
    if (!r) continue;
    const list = byTask.get(text(a.TaskUID)) ?? [];
    list.push(text(a.ResourceUID));
    byTask.set(text(a.TaskUID), list);
  }

  const rows: ImportRow[] = [];
  let minLevel = Infinity;
  for (const t of tasks) {
    const level = num(t.OutlineLevel, 1);
    // OutlineLevel 0 is MS Project's project summary row; null rows are blank lines.
    if (level === 0 || text(t.IsNull) === '1' || !text(t.Name)) continue;
    minLevel = Math.min(minLevel, level);
  }
  for (const t of tasks) {
    const level = num(t.OutlineLevel, 1);
    const name = text(t.Name);
    if (level === 0 || text(t.IsNull) === '1' || !name) continue;
    const uid = text(t.UID) || String(rows.length + 1);
    const minutes = durationMinutes(t.Duration, minutesPerDay);
    const milestone = text(t.Milestone) === '1';
    const constraintType = num(t.ConstraintType, 0); // 2 = must start on, 4 = start no earlier than
    const constraintDate = date(t.ConstraintDate);
    const manual = text(t.Manual) === '1';
    const assigned = (byTask.get(uid) ?? []).map((id) => resources.get(id)!);
    const workMinutes = durationMinutes(t.Work, minutesPerDay);
    rows.push({
      key: uid,
      name: name.slice(0, 255),
      level: Math.min(20, level - minLevel + 1),
      duration: milestone ? 0 : Math.round((minutes / minutesPerDay) * 100) / 100,
      start: manual ? date(t.Start) : (constraintType === 2 || constraintType === 4) && constraintDate ? constraintDate : date(t.Start),
      percentComplete: Math.min(100, Math.max(0, num(t.PercentComplete))),
      milestone,
      manual: manual || constraintType === 2,
      notes: text(t.Notes).slice(0, 5000),
      work: workMinutes > 0 ? Math.round((workMinutes / 60) * 100) / 100 : null,
      predecessors: ((t.PredecessorLink ?? []) as Record<string, unknown>[])
        .map((l) => ({
          key: text(l.PredecessorUID),
          type: LINK_TYPE[num(l.Type, 1)] ?? 'FS',
          // LinkLag is in tenths of a minute.
          lag: Math.round(num(l.LinkLag) / 10 / minutesPerDay),
        }))
        .filter((l) => l.key)
        .slice(0, 50),
      resources: assigned.map((r) => r.name.slice(0, 120)).slice(0, 20),
      assignee: assigned[0] ? assigned[0].email || assigned[0].name : null,
    });
    if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`Plans can have at most ${MAX_IMPORT_ROWS} tasks per import`);
  }
  if (!rows.length) throw badRequest('No tasks found in the file');

  const starts = rows.map((r) => r.start).filter((d): d is string => !!d).sort();
  return {
    name: (text(project.Title) || text(project.Name).replace(/\.mpp$/i, '') || 'Imported plan').slice(0, 120),
    startDate: date(project.StartDate) ?? starts[0] ?? null,
    rows,
    warnings,
  };
}
