'use client';

import { Field, inputCls } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { WEEKDAY_NAMES } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import type { WorkSchedule } from '@/lib/types';

export const DEFAULT_SCHEDULE: WorkSchedule = { hoursPerDay: 8, workingDays: [1, 2, 3, 4, 5] };

/** Monday-first weekday toggles plus hours per day — a person's capacity for planning. */
export function WorkScheduleFields({ value, onChange, idPrefix = 'ws' }: { value: WorkSchedule; onChange: (next: WorkSchedule) => void; idPrefix?: string }) {
  const { themeColor } = useTheme();
  const toggle = (day: number) =>
    onChange({ ...value, workingDays: value.workingDays.includes(day) ? value.workingDays.filter((d) => d !== day) : [...value.workingDays, day].sort() });
  return (
    <div className="space-y-4">
      <Field label="Hours per working day" htmlFor={`${idPrefix}-hours`}>
        <input
          id={`${idPrefix}-hours`}
          type="number"
          min={0}
          max={24}
          step={0.5}
          className={cn(inputCls, 'w-32')}
          value={value.hoursPerDay}
          onChange={(e) => onChange({ ...value, hoursPerDay: Math.max(0, Math.min(24, Number(e.target.value) || 0)) })}
        />
      </Field>
      <Field label="Working days">
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const on = value.workingDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(day)}
                className={cn(
                  'w-12 h-9 rounded-md text-xs font-semibold border transition-colors',
                  on ? 'text-white border-transparent' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                )}
                style={on ? { backgroundColor: themeColor } : undefined}
              >
                {WEEKDAY_NAMES[day]}
              </button>
            );
          })}
        </div>
      </Field>
      <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
        Weekly capacity: {Math.round(value.hoursPerDay * value.workingDays.length * 10) / 10} h
      </p>
    </div>
  );
}
