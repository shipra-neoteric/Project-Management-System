const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Safety limit: ~150 years of working days. Prevents runaway loops on bad input. */
const MAX_WORKING_DAYS = 40_000;

export function isISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && toISODate(ms) === value;
}

export function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseISODate(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

export function addDays(value: string, days: number): string {
  return toISODate(parseISODate(value) + days * DAY_MS);
}

export function todayISO(): string {
  return toISODate(Date.now());
}

/**
 * Maps working days (from the project start) to integer indexes 0, 1, 2…
 * Non-working weekdays and holidays are skipped, so scheduling maths can be
 * done on plain integers.
 */
export class WorkCalendar {
  private readonly dates: string[] = [];
  private cursor: number;
  private readonly workingDays: Set<number>;
  private readonly holidays: Set<string>;

  constructor(startDate: string, workingDays: number[], holidays: string[] = []) {
    if (!isISODate(startDate)) throw new Error(`Invalid start date: ${startDate}`);
    this.workingDays = new Set(workingDays.filter((d) => d >= 0 && d <= 6));
    if (this.workingDays.size === 0) throw new Error('A calendar needs at least one working day');
    this.holidays = new Set(holidays);
    this.cursor = parseISODate(startDate);
  }

  /** Date of the working day with the given index (negative indexes clamp to 0). */
  dateAt(index: number): string {
    const i = Math.max(0, Math.floor(index));
    while (this.dates.length <= i) this.pushNext();
    return this.dates[i];
  }

  /** Index of the first working day on or after `date`. Dates before the start map to 0. */
  indexOf(date: string): number {
    while (this.dates.length === 0 || this.dates[this.dates.length - 1] < date) this.pushNext();
    let lo = 0;
    let hi = this.dates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] < date) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private pushNext(): void {
    if (this.dates.length >= MAX_WORKING_DAYS) throw new Error('Schedule exceeds the supported date range');
    for (;;) {
      const iso = toISODate(this.cursor);
      const weekday = new Date(this.cursor).getUTCDay();
      this.cursor += DAY_MS;
      if (this.workingDays.has(weekday) && !this.holidays.has(iso)) {
        this.dates.push(iso);
        return;
      }
    }
  }
}
