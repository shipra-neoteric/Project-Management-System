'use client';

import { AlertTriangle } from 'lucide-react';
import { useTheme } from '@/lib/theme';

/**
 * Utilisation heat scale (dataviz rules): one blue sequential ramp, light→dark for magnitude, chosen
 * separately per mode so low load recedes toward the surface; over-allocation uses the reserved
 * status-critical red and always ships with an icon, never colour alone.
 */
const STEPS = {
  // blue 100 → 500 on the light surface
  light: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf'],
  // blue 700 → 300 on the dark surface
  dark: ['#0d366b', '#104281', '#1c5cab', '#2a78d6', '#6da7ec'],
};
const INK = {
  light: ['#1f2937', '#1f2937', '#1f2937', '#ffffff', '#ffffff'],
  dark: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#0b0b0b'],
};
export const CRITICAL = '#d03b3b';
const BUCKETS = [0.25, 0.5, 0.75, 0.9, 1];
export const LEGEND_LABELS = ['≤ 25 %', '≤ 50 %', '≤ 75 %', '≤ 90 %', '≤ 100 %'];

export type LoadState = 'empty' | 'off' | 'nonworking' | 'normal' | 'over';

export interface LoadCell {
  state: LoadState;
  ratio: number;
  bg?: string;
  fg?: string;
}

export function useLoadScale() {
  const { isDark } = useTheme();
  const mode = isDark ? 'dark' : 'light';
  /** Classifies one person-day (or week) by allocated vs available hours. */
  const cell = (allocated: number, capacity: number, timeOff = false): LoadCell => {
    if (allocated > 0 && allocated > capacity + 0.01) return { state: 'over', ratio: capacity ? allocated / capacity : Infinity, bg: CRITICAL, fg: '#ffffff' };
    if (timeOff && allocated <= 0) return { state: 'off', ratio: 0 };
    if (capacity <= 0) return { state: 'nonworking', ratio: 0 };
    if (allocated <= 0) return { state: 'empty', ratio: 0 };
    const ratio = allocated / capacity;
    const i = Math.max(0, BUCKETS.findIndex((b) => ratio <= b + 1e-9));
    return { state: 'normal', ratio, bg: STEPS[mode][i], fg: INK[mode][i] };
  };
  return { cell, steps: STEPS[mode] };
}

/** Diagonal hatch for time off (texture, so it reads without colour). */
export const HATCH = {
  backgroundImage: 'repeating-linear-gradient(135deg, rgba(156,163,175,0.35) 0 2px, transparent 2px 6px)',
};

export function LoadLegend({ showTimeOff = true }: { showTimeOff?: boolean }) {
  const { steps } = useLoadScale();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-gray-300" aria-label="Legend">
      <span className="font-medium text-gray-500 dark:text-gray-400">Booked of capacity:</span>
      {steps.map((c, i) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-[3px]" style={{ backgroundColor: c }} />
          {LEGEND_LABELS[i]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded-[3px] flex items-center justify-center" style={{ backgroundColor: CRITICAL }}>
          <AlertTriangle className="w-2.5 h-2.5 text-white" />
        </span>
        Over capacity
      </span>
      {showTimeOff && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-[3px] border border-gray-300 dark:border-gray-600" style={HATCH} />
          Time off
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded-[3px] bg-gray-100 dark:bg-gray-700/60" />
        Non-working
      </span>
    </div>
  );
}

/** "7.5" → "7.5", 8 → "8" */
export const hrs = (n: number) => String(Math.round(n * 10) / 10);
