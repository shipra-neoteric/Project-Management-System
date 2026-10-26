'use client';

import { cn } from '@/lib/cn';
import { useLiveStatus } from '@/lib/liveStatus';

const LABELS = {
  live: { text: 'Live', title: 'Changes by your teammates appear instantly', dot: 'bg-green-500', ping: true },
  connecting: { text: 'Connecting', title: 'Connecting to live updates…', dot: 'bg-amber-400', ping: false },
  reconnecting: { text: 'Reconnecting', title: 'Live updates interrupted — reconnecting. Data refreshes every 2 minutes meanwhile.', dot: 'bg-amber-400', ping: false },
  offline: { text: 'Paused', title: 'Live updates are paused while this tab is in the background', dot: 'bg-gray-400', ping: false },
} as const;

/** Small "Live / Reconnecting" pill in the header. */
export function LiveIndicator() {
  const status = useLiveStatus();
  const l = LABELS[status];
  return (
    <span
      className="hidden md:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 select-none"
      title={l.title}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex w-2 h-2">
        {l.ping && <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60 animate-ping" />}
        <span className={cn('relative inline-flex w-2 h-2 rounded-full', l.dot)} />
      </span>
      {l.text}
    </span>
  );
}
