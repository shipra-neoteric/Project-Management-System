import { env } from '../config/env';
import { richTextToPlain } from '../utils/richText';

export interface IcsMeeting {
  _id: unknown;
  title: string;
  location: string;
  startsAt: Date;
  durationMinutes: number;
  sequence?: number;
  status?: string;
  agenda: { title: string; durationMinutes?: number | null }[];
}

interface Person {
  name: string;
  email?: string | null;
}

/** 20261102T093000Z */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded with CRLF + space (RFC 5545 §3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * An iCalendar file for one meeting. METHOD:REQUEST makes Outlook/Gmail show Accept/Decline;
 * METHOD:CANCEL removes it from calendars; PUBLISH is a plain download.
 */
export function meetingIcs(meeting: IcsMeeting, projectName: string, organizer: Person, attendees: Person[], method: 'REQUEST' | 'PUBLISH' | 'CANCEL' = 'PUBLISH'): string {
  const start = new Date(meeting.startsAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  const agenda = meeting.agenda.map((a, i) => `${i + 1}. ${a.title}${a.durationMinutes ? ` (${a.durationMinutes} min)` : ''}`).join('\n');
  const description = [`Project: ${projectName}`, agenda ? `\nAgenda:\n${agenda}` : '', `\nOpen in the app: ${env.appUrl}`].join('\n');
  const mail = (p: Person) => p.email || 'no-reply@example.com';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Project Management System//Meetings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:meeting-${String(meeting._id)}@pms`,
    `SEQUENCE:${meeting.sequence ?? 0}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(meeting.title)}`,
    ...(meeting.location ? [`LOCATION:${escapeText(meeting.location)}`] : []),
    `DESCRIPTION:${escapeText(richTextToPlain(description))}`,
    `ORGANIZER;CN=${escapeText(organizer.name)}:mailto:${mail(organizer)}`,
    ...attendees.map((a) => `ATTENDEE;CN=${escapeText(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${mail(a)}`),
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
