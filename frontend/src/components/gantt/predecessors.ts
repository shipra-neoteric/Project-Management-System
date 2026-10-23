import type { LinkType, Task, TaskLink } from '@/lib/types';

/** "3, 5SS+2, 7FF-1" — MS Project style predecessor text using row numbers. */
export function formatPredecessors(links: TaskLink[], byId: Map<string, Task>): string {
  return links
    .map((l) => {
      const row = byId.get(l.task)?.rowNumber;
      if (!row) return null;
      const lag = l.lag > 0 ? `+${l.lag}` : l.lag < 0 ? `${l.lag}` : '';
      return l.type === 'FS' && !lag ? `${row}` : `${row}${l.type}${lag}`;
    })
    .filter(Boolean)
    .join(', ');
}

const TOKEN = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*d?)?$/i;

/** Parses predecessor text. Throws an Error with a friendly message on bad input. */
export function parsePredecessors(text: string, tasks: Task[], self: Task): TaskLink[] {
  const byRow = new Map(tasks.map((t) => [t.rowNumber, t]));
  const links: TaskLink[] = [];
  for (const raw of text.split(/[,;]/)) {
    const token = raw.trim();
    if (!token) continue;
    const m = TOKEN.exec(token);
    if (!m) throw new Error(`"${token}" is not valid. Use row numbers like 3, 5SS, 7FS+2`);
    const target = byRow.get(Number(m[1]));
    if (!target) throw new Error(`There is no task in row ${m[1]}`);
    if (target._id === self._id) throw new Error('A task cannot be its own predecessor');
    const lag = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
    links.push({ task: target._id, type: ((m[2] ?? 'FS').toUpperCase() as LinkType), lag });
  }
  return links;
}

export const LINK_LABELS: Record<LinkType, string> = {
  FS: 'Finish-to-Start (FS)',
  SS: 'Start-to-Start (SS)',
  FF: 'Finish-to-Finish (FF)',
  SF: 'Start-to-Finish (SF)',
};
