'use client';

import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { keys } from '@/features/queries';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setLiveStatus } from '@/lib/liveStatus';
import type { Plan } from '@/lib/types';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
/** Close the stream after the tab has been hidden this long; reconnect and resync when it is visible again. */
const HIDDEN_GRACE_MS = 60_000;
const BATCH_MS = 400;
const TOAST_EVERY_MS = 5_000;

/** What the server sends for every change (never the request body). */
interface LiveEvent {
  id: string;
  type: string;
  action: 'created' | 'updated' | 'deleted';
  resource: string;
  projectId: string | null;
  entityId: string | null;
  taskId: string | null;
  actor: { id: string; name: string } | null;
  at: string;
}

/** Which cached queries an event makes stale. */
function staleKeys(e: LiveEvent, fromOthers: boolean): (QueryKey | ((key: QueryKey) => boolean))[] {
  const out: (QueryKey | ((key: QueryKey) => boolean))[] = [];
  const r = e.resource;
  if (e.projectId) {
    const pid = e.projectId;
    // Every query of that project (plan, overview, activity, budgets, costs, rates, views, meetings, reports…).
    out.push((key) => key.includes(pid), keys.projects, keys.dashboard, ['planner']);
    if (e.taskId) out.push(keys.activity(e.taskId), keys.attachments(e.taskId));
    if (r.includes('time') || r.includes('cost') || r.includes('rates')) out.push(['time-entries'], ['report']);
    if (fromOthers) out.push(keys.notifications);
    return out;
  }
  if (r.startsWith('work-settings')) out.push(keys.workSettings);
  else if (r.startsWith('global-roles')) out.push(keys.globalRoles, keys.users);
  else if (r.startsWith('roles')) out.push(keys.roles, ['project'], ['plan'], keys.projects);
  else if (r.startsWith('groups')) out.push(keys.groups, ['project'], ['plan']);
  else if (r.startsWith('users')) out.push(keys.users, ['project'], ['plan'], ['planner']);
  else if (r.startsWith('settings')) out.push(keys.settings);
  else if (r.startsWith('project-views')) out.push(keys.projectViews);
  else if (r.startsWith('time-entries') || r.startsWith('rates')) out.push(['time-entries'], ['report'], ['rates'], ['plan'], ['budgets']);
  else if (r.startsWith('time-off')) out.push(['time-off'], ['planner']);
  else if (r.startsWith('notifications')) out.push(keys.notifications);
  else out.push(keys.projects, keys.dashboard);
  return out;
}

function invalidate(qc: QueryClient, targets: (QueryKey | ((key: QueryKey) => boolean))[]) {
  const exact = new Map<string, QueryKey>();
  const predicates: ((key: QueryKey) => boolean)[] = [];
  for (const t of targets) {
    if (typeof t === 'function') predicates.push(t);
    else exact.set(JSON.stringify(t), t);
  }
  for (const key of exact.values()) void qc.invalidateQueries({ queryKey: key });
  if (predicates.length) void qc.invalidateQueries({ predicate: (q) => predicates.some((p) => p(q.queryKey)) });
}

/** "Priya updated 'Partitions & ceilings'" */
function describe(e: LiveEvent, qc: QueryClient): string | null {
  if (!e.actor || !e.projectId || !e.resource.startsWith('projects/tasks')) return null;
  const plan = qc.getQueryData<Plan>(keys.plan(e.projectId));
  const task = e.taskId ? plan?.tasks.find((t) => t._id === e.taskId) : undefined;
  const name = task ? `“${task.name}”` : 'a task';
  const first = e.actor.name.split(' ')[0];
  if (e.resource === 'projects/tasks/comments') return e.action === 'created' ? `${first} commented on ${name}` : null;
  if (e.resource === 'projects/tasks/attachments') return e.action === 'created' ? `${first} attached a file to ${name}` : null;
  if (e.resource === 'projects/tasks') return `${first} ${e.action === 'created' ? 'added' : e.action === 'deleted' ? 'deleted' : 'updated'} ${name}`;
  return `${first} changed ${e.action === 'deleted' ? 'tasks' : 'the plan'}`;
}

async function toastInfo(title: string) {
  const Swal = (await import('sweetalert2')).default;
  void Swal.fire({ icon: 'info', title, toast: true, position: 'bottom-end', timer: 3500, showConfirmButton: false });
}

/**
 * Keeps every open screen up to date: listens to the server's change stream and refreshes the
 * affected data. Also drives the header's "Live" indicator and the slow fallback polling.
 */
export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { user, status } = useAuth();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const meRef = useRef<string | null>(null);
  meRef.current = user?._id ?? null;

  useEffect(() => {
    if (status !== 'authenticated') {
      setLiveStatus('offline');
      return;
    }
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;
    let connectedBefore = false;
    let pending: LiveEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastToast = 0;

    const flush = () => {
      flushTimer = null;
      const batch = pending;
      pending = [];
      const targets = batch.flatMap((e) => staleKeys(e, e.actor?.id !== meRef.current));
      invalidate(qc, targets);
      // A small toast for teammates' task changes in the project on screen.
      const viewing = pathRef.current.match(/^\/projects\/([a-f0-9]{24})/)?.[1];
      const now = Date.now();
      if (!viewing || now - lastToast < TOAST_EVERY_MS) return;
      const theirs = batch.filter((e) => e.projectId === viewing && e.actor && e.actor.id !== meRef.current);
      const text = theirs.map((e) => describe(e, qc)).find(Boolean);
      if (text) {
        lastToast = now;
        void toastInfo(text);
      }
    };

    const close = () => {
      source?.close();
      source = null;
    };

    const schedule = () => {
      if (stopped || retry) return;
      setLiveStatus('reconnecting');
      const delay = Math.min(30_000, 1_000 * 2 ** attempt) + Math.random() * 500;
      attempt++;
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (stopped || source || document.visibilityState === 'hidden') return;
      setLiveStatus(connectedBefore ? 'reconnecting' : 'connecting');
      let ticket: string;
      try {
        ticket = (await api<{ ticket: string }>('/events/ticket', { method: 'POST' })).ticket;
      } catch {
        schedule();
        return;
      }
      if (stopped) return;
      const es = new EventSource(`${API_URL}/events/stream?ticket=${encodeURIComponent(ticket)}`);
      source = es;
      es.addEventListener('ready', () => {
        attempt = 0;
        setLiveStatus('live');
        // After a gap, refresh what is on screen: events may have been missed.
        if (connectedBefore) void qc.invalidateQueries({ type: 'active' });
        connectedBefore = true;
      });
      es.addEventListener('change', (msg) => {
        try {
          pending.push(JSON.parse((msg as MessageEvent<string>).data) as LiveEvent);
        } catch {
          return;
        }
        flushTimer ??= setTimeout(flush, BATCH_MS);
      });
      // Tickets are single use, so let the browser's auto-retry go and reconnect with a fresh one.
      es.onerror = () => {
        if (source !== es) return;
        close();
        schedule();
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimer = setTimeout(() => {
          close();
          if (retry) clearTimeout(retry);
          retry = null;
          setLiveStatus('offline');
        }, HIDDEN_GRACE_MS);
      } else {
        if (hiddenTimer) clearTimeout(hiddenTimer);
        hiddenTimer = null;
        if (!source && !retry) {
          attempt = 0;
          void connect();
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    void connect();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      for (const t of [retry, hiddenTimer, flushTimer]) if (t) clearTimeout(t);
      close();
      setLiveStatus('offline');
    };
  }, [status, qc]);

  return <>{children}</>;
}
