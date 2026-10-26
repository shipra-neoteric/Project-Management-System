'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { inputCls } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const FEED_KEY = ['calendar-feed'] as const;

export const myTasksFeedUrl = (token: string) => `${API_URL}/ical/${token}/my-tasks.ics`;
export const projectFeedUrl = (token: string, projectId: string) => `${API_URL}/ical/${token}/project/${projectId}.ics`;

/** Your secret calendar-feed token (one per person; regenerating breaks old links). */
export function useCalendarFeed() {
  const qc = useQueryClient();
  const { refreshUser } = useAuth();
  const query = useQuery({ queryKey: FEED_KEY, queryFn: () => api<{ token: string | null; createdAt: string | null }>('/calendar-feed') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: FEED_KEY });
    void refreshUser();
  };
  return {
    ...query,
    create: useMutation({ mutationFn: () => api<{ token: string }>('/calendar-feed', { method: 'POST' }), onSuccess: refresh }),
    revoke: useMutation({ mutationFn: () => api('/calendar-feed', { method: 'DELETE' }), onSuccess: refresh }),
  };
}

function CopyField({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      void toastError('Copy failed — select the link and copy it');
    }
  };
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={url} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono !text-xs`} aria-label={label} />
        <Button size="md" icon={copied ? Check : Copy} onClick={copy} title="Copy link">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/** Profile card: subscribe to your tasks in Outlook, Google Calendar or Apple Calendar. */
export function CalendarFeedCard() {
  const feed = useCalendarFeed();
  const token = feed.data?.token;

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      void toastSuccess(success);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Card title="Calendar subscription" icon={CalendarPlus}>
      <div className="p-5 space-y-4 text-sm text-gray-600 dark:text-gray-300">
        <p>Show your tasks and your projects’ milestones in Outlook, Google Calendar or Apple Calendar. The calendar refreshes by itself (usually every few hours).</p>
        {feed.isLoading ? null : token ? (
          <>
            <CopyField label="My tasks" url={myTasksFeedUrl(token)} />
            <p className="text-xs text-gray-500 dark:text-gray-400">A project’s full calendar link is under the project’s Settings tab.</p>
            <details className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 px-4 py-3">
              <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-100">How to add it</summary>
              <ul className="mt-2 space-y-1.5 list-disc pl-4 text-xs">
                <li>
                  <span className="font-medium">Outlook:</span> Calendar → Add calendar → Subscribe from web → paste the link.
                </li>
                <li>
                  <span className="font-medium">Google Calendar:</span> Other calendars → + → From URL → paste the link.
                </li>
                <li>
                  <span className="font-medium">Apple Calendar:</span> File → New Calendar Subscription → paste the link.
                </li>
              </ul>
            </details>
            <p className="text-xs text-amber-600 dark:text-amber-400">Anyone with this link can see these tasks. Keep it private; create a new link if it leaks.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={RefreshCw}
                loading={feed.create.isPending}
                onClick={async () => {
                  if (await confirmDanger('Create a new link?', 'Calendars using the current link stop updating until you add the new one.', 'Create new link')) {
                    await run(() => feed.create.mutateAsync(), 'New calendar link created');
                  }
                }}
              >
                New link
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                loading={feed.revoke.isPending}
                onClick={async () => {
                  if (await confirmDanger('Turn off calendar links?', 'Subscribed calendars stop updating.', 'Turn off')) await run(() => feed.revoke.mutateAsync(), 'Calendar links turned off');
                }}
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <Button variant="primary" icon={CalendarPlus} loading={feed.create.isPending} onClick={() => run(() => feed.create.mutateAsync(), 'Calendar link created')}>
            Create my calendar link
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Project settings card: subscribe to this project's tasks and milestones. */
export function ProjectCalendarCard({ projectId }: { projectId: string }) {
  const feed = useCalendarFeed();
  const token = feed.data?.token;
  return (
    <Card title="Subscribe in calendar" icon={CalendarPlus}>
      <div className="p-5 space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>Every task and milestone of this project in Outlook, Google or Apple Calendar.</p>
        {feed.isLoading ? null : token ? (
          <CopyField label="Project calendar link" url={projectFeedUrl(token, projectId)} />
        ) : (
          <Button
            icon={CalendarPlus}
            loading={feed.create.isPending}
            onClick={() => feed.create.mutateAsync().then(() => toastSuccess('Calendar link created'), (err) => toastError(errorMessage(err)))}
          >
            Create calendar link
          </Button>
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500">The link is personal: it shows what you can see. Manage it in your profile.</p>
      </div>
    </Card>
  );
}
