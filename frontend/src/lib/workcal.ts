import { addDays, weekday } from './dates';
import type { Project } from './types';

/** Client-side working-day helpers that mirror the server calendar (used for drag & drop). */
export function isWorkingDay(project: Pick<Project, 'workingDays' | 'holidays'>, iso: string): boolean {
  return project.workingDays.includes(weekday(iso)) && !project.holidays.includes(iso);
}

/** First working day on or after `iso`. */
export function nextWorkingDay(project: Pick<Project, 'workingDays' | 'holidays'>, iso: string): string {
  let d = iso;
  for (let i = 0; i < 366 && !isWorkingDay(project, d); i++) d = addDays(d, 1);
  return d;
}

/** Working days from `start` to `finish`, both inclusive (0 if finish is before start). */
export function workingDaysBetween(project: Pick<Project, 'workingDays' | 'holidays'>, start: string, finish: string): number {
  let n = 0;
  for (let d = start; d <= finish && n < 10_000; d = addDays(d, 1)) if (isWorkingDay(project, d)) n++;
  return n;
}
