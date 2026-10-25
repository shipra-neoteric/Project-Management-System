import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export type ChangeAction = 'created' | 'updated' | 'deleted';

/**
 * One successful change made through the API. Published after the response is sent, so listeners
 * (live updates, webhooks, audit trail) never slow down or break the request that caused it.
 */
export interface AppEvent {
  id: string;
  at: string;
  /** e.g. "task.updated", "project.members.created", "time-entry.deleted" */
  type: string;
  action: ChangeAction;
  /** Resource path without ids, e.g. "projects/tasks/comments". */
  resource: string;
  method: string;
  path: string;
  status: number;
  actor: { id: string; name: string } | null;
  projectId: string | null;
  /** The record the change was about, when known (the last id in the path, or the id of a created record). */
  entityId: string | null;
  requestId?: string;
  /** Request body with secrets removed (used by the audit trail; never sent to webhooks as-is). */
  body?: unknown;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(event: Omit<AppEvent, 'id' | 'at'>): AppEvent {
  const full: AppEvent = { id: randomUUID(), at: new Date().toISOString(), ...event };
  // Listeners run on the next tick and are isolated from each other.
  setImmediate(() => {
    for (const listener of bus.listeners('event') as ((e: AppEvent) => unknown)[]) {
      try {
        const r = listener(full);
        if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch((err) => console.error('[events] listener failed', err));
      } catch (err) {
        console.error('[events] listener failed', err);
      }
    }
  });
  return full;
}

/** Subscribe to every change; returns an unsubscribe function. */
export function subscribe(listener: (event: AppEvent) => unknown): () => void {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
