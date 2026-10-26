import { env } from '../config/env';
import { addDays } from '../scheduling/calendar';

/** One all-day event (dates are inclusive YYYY-MM-DD; DTEND is written exclusive as RFC 5545 requires). */
export interface CalendarEvent {
  uid: string;
  start: string;
  end: string;
  summary: string;
  description: string;
  url: string;
  updatedAt?: Date | string | null;
  categories?: string[];
  status?: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
}

/** Escapes TEXT values: backslash, semicolon, comma and newlines. */
export function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets (UTF-8), continuing with CRLF + space, never splitting a character. */
export function foldLine(line: string) {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

const dateValue = (iso: string) => iso.replace(/-/g, '');
const stamp = (d?: Date | string | null) => new Date(d ?? Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Builds a complete VCALENDAR document. */
export function buildCalendar(name: string, events: CalendarEvent[]) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Project Management System//Tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const now = stamp();
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${stamp(e.updatedAt)}`,
      `DTSTART;VALUE=DATE:${dateValue(e.start)}`,
      `DTEND;VALUE=DATE:${dateValue(addDays(e.end < e.start ? e.start : e.end, 1))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `URL:${e.url}`,
      'TRANSP:TRANSPARENT',
      ...(e.categories?.length ? [`CATEGORIES:${e.categories.map(escapeText).join(',')}`] : []),
      ...(e.status ? [`STATUS:${e.status}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** Event for a task: "[KEY-12] Name", with progress and a link back to the task. */
export function taskEvent(
  project: { _id: unknown; name: string; key?: string | null },
  t: { _id: unknown; name: string; number?: number | null; start: string; finish: string; isMilestone: boolean; percentComplete: number; updatedAt?: Date | null },
): CalendarEvent {
  const id = project.key && t.number ? `${project.key}-${t.number}` : '';
  const url = `${env.appUrl}/projects/${project._id}?task=${t._id}`;
  return {
    uid: `task-${t._id}@pms`,
    start: t.start,
    end: t.isMilestone ? t.start : t.finish,
    summary: `${t.percentComplete >= 100 ? '✓ ' : t.isMilestone ? '◆ ' : ''}${id ? `[${id}] ` : ''}${t.name}`,
    description: [`Project: ${project.name}`, t.isMilestone ? 'Milestone' : `Progress: ${t.percentComplete}%`, `Open: ${url}`].join('\n'),
    url,
    updatedAt: t.updatedAt,
    categories: [project.name, ...(t.isMilestone ? ['Milestone'] : [])],
    status: 'CONFIRMED',
  };
}
