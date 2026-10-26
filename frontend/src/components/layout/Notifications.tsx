'use client';

import { AlarmClock, AlertTriangle, AtSign, Bell, CheckCheck, MessageSquare, Pencil, Presentation, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMarkRead, useNotifications, useUnreadCount } from '@/features/queries';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import type { AppNotification } from '@/lib/types';
import { OPEN_TASK_EVENT } from './GlobalSearch';

const REASON: Record<AppNotification['reason'], { text: string; icon: typeof Bell }> = {
  mentioned: { text: 'mentioned you in', icon: AtSign },
  assigned: { text: 'assigned you to', icon: UserCheck },
  accountable: { text: 'made you accountable for', icon: UserCheck },
  commented: { text: 'commented on', icon: MessageSquare },
  updated: { text: 'updated', icon: Pencil },
  watched: { text: 'updated', icon: Pencil },
  meeting: { text: 'invited you to', icon: Presentation },
  due_soon: { text: 'coming up:', icon: AlarmClock },
  overdue: { text: 'overdue:', icon: AlertTriangle },
};

/** Date reminders come from the system, not a person. */
const isReminder = (n: AppNotification) => n.reason === 'due_soon' || n.reason === 'overdue';

export function useOpenNotification() {
  const router = useRouter();
  const markRead = useMarkRead();
  return (n: AppNotification) => {
    if (!n.read) markRead.mutate({ ids: [n._id] });
    if (n.link) return router.push(n.link);
    router.push(`/projects/${n.project}${n.task ? `?task=${n.task}` : ''}`);
    if (n.task) window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: { projectId: n.project, taskId: n.task } }));
  };
}

export function NotificationItem({ n, onOpen, compact }: { n: AppNotification; onOpen: (n: AppNotification) => void; compact?: boolean }) {
  const { icon: Icon, text } = REASON[n.reason] ?? REASON.updated;
  return (
    <button type="button" onClick={() => onOpen(n)} className={cn('w-full flex items-start gap-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50', compact ? 'px-4 py-3' : 'px-5 py-4')}>
      <span className="relative mt-0.5">
        <span className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          <Icon className="w-4 h-4 text-gray-500 dark:text-gray-300" />
        </span>
        {!n.read && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full theme-bg ring-2 ring-white dark:ring-gray-800" aria-label="Unread" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm text-gray-900 dark:text-white', !n.read && 'font-medium')}>
          {isReminder(n) ? (
            <span className={n.reason === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}>{n.reason === 'overdue' ? 'Overdue' : 'Coming up'}</span>
          ) : (
            <>
              {n.actor?.name ?? 'Someone'} <span className="text-gray-500 dark:text-gray-400 font-normal">{text}</span>
            </>
          )}{' '}
          {n.taskName || n.projectName}
        </span>
        {n.summary && <span className={cn('block text-xs text-gray-500 dark:text-gray-400 mt-0.5 whitespace-pre-line', compact && 'line-clamp-2')}>{n.summary}</span>}
        <span className="block text-[11px] text-gray-400 mt-1">
          {n.projectName} · {fmtDateTime(n.createdAt)}
        </span>
      </span>
    </button>
  );
}

/** Header bell with unread badge and a dropdown of recent notifications. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { themeColor } = useTheme();
  const count = useUnreadCount();
  const list = useNotifications(false);
  const markRead = useMarkRead();
  const openNotification = useOpenNotification();
  const unread = count.data ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void list.refetch();
        }}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center tabular-nums" style={{ backgroundColor: themeColor }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-1rem)] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 overflow-hidden animate-fade-in-down">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate({ all: true })} className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto custom-scrollbar divide-y divide-gray-100 dark:divide-gray-700">
            {(list.data?.notifications ?? []).slice(0, 10).map((n) => (
              <NotificationItem
                key={n._id}
                n={n}
                compact
                onOpen={(x) => {
                  setOpen(false);
                  openNotification(x);
                }}
              />
            ))}
            {!list.isLoading && !list.data?.notifications.length && <p className="px-4 py-8 text-center text-sm text-gray-400">You&apos;re all caught up.</p>}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-xs font-medium text-blue-600 dark:text-blue-400 border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
