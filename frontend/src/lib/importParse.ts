/** Spreadsheet (CSV / Excel) parsing for the plan import wizard. MS Project XML is parsed by the API. */

export type Cell = string | number | boolean | Date | null | undefined;
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

/** Same shape as the API's import rows. */
export interface ImportRow {
  key: string;
  name: string;
  level: number;
  duration: number;
  start?: string | null;
  percentComplete: number;
  milestone: boolean;
  manual: boolean;
  notes: string;
  work?: number | null;
  predecessors: { key: string; type: LinkType; lag: number }[];
  resources: string[];
  assignee?: string | null;
}

export const IMPORT_FIELDS = [
  { key: 'id', label: 'ID', hint: 'Row number used by predecessors (defaults to the row order)' },
  { key: 'name', label: 'Task name', required: true },
  { key: 'level', label: 'Outline level', hint: '1 = top level, 2 = under the task above…' },
  { key: 'wbs', label: 'WBS', hint: 'e.g. 1.2.3 — used for the outline when there is no level column' },
  { key: 'duration', label: 'Duration', hint: '5, 5d, 2w, 16h (0 = milestone)' },
  { key: 'start', label: 'Start' },
  { key: 'finish', label: 'Finish', hint: 'Used to work out the duration when there is none' },
  { key: 'percent', label: '% complete' },
  { key: 'predecessors', label: 'Predecessors', hint: 'e.g. 3, 4SS+2d, 7FF-1' },
  { key: 'assignee', label: 'Assignee', hint: 'Name or email of a project member' },
  { key: 'resources', label: 'Resources', hint: 'Comma-separated names' },
  { key: 'work', label: 'Work (hours)' },
  { key: 'notes', label: 'Notes' },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];
export type ColumnMap = Partial<Record<ImportField, number>>;

/** Header text patterns used to pre-select columns (English MS Project / Excel exports). */
const GUESS: Record<ImportField, RegExp> = {
  id: /^(id|#|no\.?|row|unique id|task id)$/i,
  name: /^(task )?name$|^task$|^subject$|^title$|^activity$|^description$/i,
  level: /outline.?level|^level$|^indent/i,
  wbs: /^wbs$|outline.?number|^wbs code/i,
  duration: /^duration|^days$|^dur\.?$/i,
  start: /^start|^begin|^start date/i,
  finish: /^finish|^end|^due|^finish date|^end date/i,
  percent: /%|percent|progress|complete/i,
  predecessors: /predecessor|depends|dependenc/i,
  assignee: /assign|owner|responsible|^person/i,
  resources: /resource/i,
  work: /^work|effort|hours/i,
  notes: /^notes?$|comment|remarks/i,
};

export function guessColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  // Most specific fields first so e.g. "Resource Names" is not taken as the task name.
  for (const field of ['id', 'wbs', 'level', 'predecessors', 'resources', 'percent', 'start', 'finish', 'duration', 'work', 'assignee', 'notes', 'name'] as ImportField[]) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && GUESS[field].test(h.trim()));
    if (i >= 0) {
      map[field] = i;
      used.add(i);
    }
  }
  return map;
}

// ---- Reading files -----------------------------------------------------------------------------

/** RFC 4180 CSV with auto-detected delimiter (comma, semicolon or tab). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Reads a CSV or Excel file into a header row + data rows. */
export async function readSheet(file: File): Promise<{ headers: string[]; rows: Cell[][] }> {
  let table: Cell[][];
  if (/\.csv$|\.txt$/i.test(file.name)) {
    table = parseCsv(await file.text());
  } else {
    const { default: readXlsxFile } = await import('read-excel-file');
    table = (await readXlsxFile(file)) as Cell[][];
  }
  const nonEmpty = table.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
  if (nonEmpty.length < 2) throw new Error('The sheet needs a header row and at least one task');
  const [header, ...rows] = nonEmpty;
  return { headers: header.map((h, i) => (h === null || h === undefined || String(h).trim() === '' ? `Column ${i + 1}` : String(h).trim())), rows };
}

// ---- Value parsing ------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Date cell → YYYY-MM-DD. `dayFirst` decides 02/11/2026 (2 Nov) vs (11 Feb). */
export function parseDate(value: Cell, dayFirst: boolean): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : isoOf(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  const s = String(value).trim().replace(/^[A-Za-z]{3,9},?\s+(?=\d)/, ''); // drop a leading weekday ("Mon 02/11/26")
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return dayFirst ? isoOf(year, +m[2], +m[1]) : isoOf(year, +m[1], +m[2]);
  }
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/** "5", "5d", "5 days", "2w", "16h", "1.5 days" → working days. */
export function parseDuration(value: Cell): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(d|day|days|w|wk|wks|week|weeks|h|hr|hrs|hour|hours|mo|mon|month|months)?\??$/i.exec(String(value).trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] ?? 'd').toLowerCase();
  if (unit.startsWith('w')) return n * 5;
  if (unit.startsWith('h')) return n / 8;
  if (unit.startsWith('mo')) return n * 20;
  return n;
}

/** "3", "3FS", "4SS+2d", "7FF-1 day", "3, 5SS" → links (lags in working days). */
export function parsePredecessors(value: Cell): ImportRow['predecessors'] {
  if (value === null || value === undefined || value === '') return [];
  return String(value)
    .split(/[,;]/)
    .map((part) => /^\s*([A-Za-z0-9._-]+?)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(d|days?|w|wks?|weeks?|h|hrs?|hours?)?)?\s*$/i.exec(part))
    .filter((m): m is RegExpExecArray => !!m && !!m[1])
    .map((m) => {
      const amount = m[4] ? parseFloat(m[4]) : 0;
      const unit = (m[5] ?? 'd').toLowerCase();
      const days = unit.startsWith('w') ? amount * 5 : unit.startsWith('h') ? amount / 8 : amount;
      return { key: m[1], type: ((m[2] ?? 'FS').toUpperCase() as LinkType), lag: Math.round(m[3] === '-' ? -days : days) };
    });
}

const workdaysBetween = (start: string, finish: string) => {
  let n = 0;
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${finish}T00:00:00Z`) && n < 5000; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
};

const str = (v: Cell) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();

/** Converts mapped sheet rows into import rows, collecting warnings for values it could not read. */
export function rowsFromSheet(rows: Cell[][], map: ColumnMap, options: { dayFirst: boolean }): { rows: ImportRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.length < 50 && warnings.push(msg);
  const get = (r: Cell[], f: ImportField) => (map[f] === undefined ? undefined : r[map[f]!]);

  // Percent column: fractions (0–1) from Excel percentage cells, or 0–100.
  const percents = rows.map((r) => get(r, 'percent')).filter((v) => typeof v === 'number') as number[];
  const fractional = percents.length > 0 && percents.every((p) => p >= 0 && p <= 1) && percents.some((p) => p > 0 && p < 1);

  const out: ImportRow[] = [];
  rows.forEach((r, i) => {
    const name = str(get(r, 'name'));
    if (!name) return;
    const line = i + 2; // header is line 1
    let level = Number(str(get(r, 'level'))) || 0;
    if (!level && map.wbs !== undefined) level = str(get(r, 'wbs')).split('.').filter(Boolean).length;
    const start = parseDate(get(r, 'start') ?? null, options.dayFirst);
    if (get(r, 'start') && !start) warn(`Line ${line}: could not read the start date "${str(get(r, 'start'))}"`);
    const finish = parseDate(get(r, 'finish') ?? null, options.dayFirst);
    let duration = parseDuration(get(r, 'duration') ?? null);
    if (duration === null && get(r, 'duration')) warn(`Line ${line}: could not read the duration "${str(get(r, 'duration'))}"`);
    if (duration === null && start && finish) duration = finish >= start ? workdaysBetween(start, finish) : 1;
    const rawPct = get(r, 'percent');
    let pct = typeof rawPct === 'number' ? (fractional ? rawPct * 100 : rawPct) : parseFloat(str(rawPct).replace('%', '')) || 0;
    pct = Math.min(100, Math.max(0, Math.round(pct)));
    // Work: plain numbers are hours; values like "2d" or "1w" are converted at 8 h per day.
    const rawWork = get(r, 'work');
    const work =
      typeof rawWork === 'number' ? rawWork : /\d\s*(d|day|w|wk|week)/i.test(str(rawWork)) ? (parseDuration(rawWork ?? null) ?? 0) * 8 : parseFloat(str(rawWork).replace(/[^\d.]/g, '')) || null;
    out.push({
      key: str(get(r, 'id')) || String(i + 1),
      name: name.slice(0, 255),
      level: Math.min(20, Math.max(1, level || 1)),
      duration: Math.max(0, duration ?? 1),
      start,
      percentComplete: pct,
      milestone: duration === 0,
      manual: false,
      notes: str(get(r, 'notes')).slice(0, 5000),
      work,
      predecessors: parsePredecessors(get(r, 'predecessors') ?? null),
      resources: str(get(r, 'resources'))
        .split(/[,;]/)
        .map((s) => s.replace(/\[.*?\]/g, '').trim()) // MS Project adds "[50%]" to resource names
        .filter(Boolean)
        .slice(0, 20),
      assignee: str(get(r, 'assignee')) || null,
    });
  });
  if (!out.length) warnings.push('No rows have a task name. Check the column mapping.');
  return { rows: out, warnings };
}

/** Sample CSV template people can fill in. */
export const SAMPLE_CSV = [
  'ID,Task name,Outline level,Duration,Start,% complete,Predecessors,Assignee,Resources,Work (hours),Notes',
  '1,Design & approvals,1,,,,,,,,Summary row',
  '2,Site survey,2,2d,02/11/2026,100,,priya@example.com,Survey team,16,Measure the floor plate',
  '3,Detailed drawings,2,5d,,20,2FS+1d,Priya Sharma,,60,',
  '4,Client approval,2,0,,,3,,,,Milestone',
  '5,Civil works,1,,,,,,,,',
  '6,Partitions & ceilings,2,8d,,,4SS,Rahul Verma,Carpentry crew,64,',
  '7,Flooring,2,5d,,,6,,"Carpentry crew, Tilers",40,',
].join('\r\n');
