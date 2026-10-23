const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const parseISO = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => toISO(parseISO(iso) + days * DAY_MS);
export const diffDays = (from: string, to: string) => Math.round((parseISO(to) - parseISO(from)) / DAY_MS);
export const weekday = (iso: string) => new Date(parseISO(iso)).getUTCDay();

/** Today's date in the user's local timezone as YYYY-MM-DD. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "02 Nov 2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(parseISO(iso));
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mon 02/11/26" — compact grid format like MS Project */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(parseISO(iso));
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${WEEKDAYS[d.getUTCDay()]} ${dd}/${mm}/${String(d.getUTCFullYear()).slice(2)}`;
}

export function monthLabel(iso: string, withYear = true): string {
  const d = new Date(parseISO(iso));
  return withYear ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : MONTHS[d.getUTCMonth()];
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const WEEKDAY_NAMES = WEEKDAYS;
