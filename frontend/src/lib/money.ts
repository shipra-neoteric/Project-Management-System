'use client';

import { useWorkSettings } from '@/features/queries';

/** "₹1,23,450.00" style amounts in the organisation's currency. */
export function fmtMoney(value: number | null | undefined, currency = 'INR'): string {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Hours with up to two decimals: 7.5 → "7.5 h". */
export const fmtHours = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(value * 100) / 100} h`);

/** The organisation currency (from work settings) and a formatter bound to it. */
export function useMoney() {
  const currency = useWorkSettings().data?.currency ?? 'INR';
  return { currency, money: (value: number | null | undefined) => fmtMoney(value, currency) };
}
