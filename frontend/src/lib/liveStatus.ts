'use client';

import { useSyncExternalStore } from 'react';

/** Live-update connection state, shared without React context so data hooks can read it. */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

let status: LiveStatus = 'offline';
const listeners = new Set<() => void>();

export function setLiveStatus(next: LiveStatus) {
  if (next === status) return;
  status = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(subscribe, () => status, () => 'offline');
}

/** Slow fallback polling while live updates are not connected. */
export const FALLBACK_POLL_MS = 120_000;

/**
 * Polling interval for data that live updates keep fresh: `whileLive` (default: none) while
 * connected, a slow fallback otherwise.
 */
export function useLivePollInterval(whileLive: number | false = false): number | false {
  return useLiveStatus() === 'live' ? whileLive : FALLBACK_POLL_MS;
}
