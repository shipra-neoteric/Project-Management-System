import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { Project, type ProjectDoc } from '../models/Project';
import { User, type UserDoc } from '../models/User';
import { subscribe, type AppEvent } from '../services/events';
import { accessFor, attachAccess, loadRoles } from '../services/permissions';
import { HttpError } from '../utils/http';

/**
 * Live updates over Server-Sent Events.
 *   POST /api/events/ticket  (signed in)  → { ticket } — single use, valid 60 s
 *   GET  /api/events/stream?ticket=…      → text/event-stream of change events the user may see
 * EventSource cannot send an Authorization header, so the JWT never goes into the URL; the ticket does.
 */
export const liveTicketRouter = Router();
export const liveStreamRouter = Router();

const TICKET_TTL_MS = 60_000;
const MAX_TICKETS = 10_000;
const MAX_CONNECTIONS_PER_USER = 5;
const MAX_BUFFERED_BYTES = 1_000_000;
const HEARTBEAT_MS = 25_000;
const USER_REFRESH_MS = 60_000;
const PROJECT_CACHE_MS = 2_000;
/** Resources that only matter to the person who changed them. */
const PERSONAL = /^(auth|notifications|me)(\/|$)/;

const tickets = new Map<string, { userId: string; expires: number }>();

liveTicketRouter.post('/ticket', (req, res) => {
  const now = Date.now();
  if (tickets.size >= MAX_TICKETS) for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
  if (tickets.size >= MAX_TICKETS) throw new HttpError(503, 'BUSY', 'Too many pending connections, try again shortly');
  const ticket = randomBytes(24).toString('hex');
  tickets.set(ticket, { userId: String(req.user!._id), expires: now + TICKET_TTL_MS });
  res.json({ ticket, expiresIn: TICKET_TTL_MS / 1000 });
});

interface Connection {
  user: UserDoc;
  res: Response;
  loadedAt: number;
  /** Projects this connection was allowed to see (so it still hears about their deletion). */
  seen: Set<string>;
}
const connections = new Set<Connection>();

/** Short-lived cache so a burst of events for one project costs one lookup. */
const projectCache = new Map<string, { doc: ProjectDoc | null; at: number }>();
async function projectDoc(id: string) {
  const hit = projectCache.get(id);
  if (hit && Date.now() - hit.at < PROJECT_CACHE_MS) return hit.doc;
  const doc = await Project.findById(id);
  projectCache.set(id, { doc, at: Date.now() });
  if (projectCache.size > 500) projectCache.delete(projectCache.keys().next().value!);
  return doc;
}

function send(conn: Connection, event: string, data: unknown) {
  // Drop clients that stop reading instead of buffering without bound.
  if (conn.res.writableLength > MAX_BUFFERED_BYTES) {
    close(conn);
    return;
  }
  conn.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function close(conn: Connection) {
  connections.delete(conn);
  try {
    conn.res.end();
  } catch {
    /* already closed */
  }
}

async function refreshUser(conn: Connection) {
  if (Date.now() - conn.loadedAt < USER_REFRESH_MS) return;
  const fresh = await User.findById(conn.user._id);
  if (!fresh || !fresh.isActive) return close(conn);
  await attachAccess(fresh);
  conn.user = fresh;
  conn.loadedAt = Date.now();
}

/** Public shape of an event: never the request body, path or IP. */
function payload(e: AppEvent) {
  const segments = e.path.split('/');
  const t = segments.indexOf('tasks');
  const taskId = t >= 0 && /^[a-f0-9]{24}$/i.test(segments[t + 1] ?? '') ? segments[t + 1] : e.resource === 'projects/tasks' ? e.entityId : null;
  return { id: e.id, type: e.type, action: e.action, resource: e.resource, projectId: e.projectId, entityId: e.entityId, taskId, actor: e.actor, at: e.at };
}

async function dispatch(e: AppEvent) {
  if (!connections.size) return;
  const data = payload(e);
  // Time entries carry their project in the body rather than the path.
  const body = (e.body ?? {}) as Record<string, unknown>;
  const projectId = e.projectId ?? (typeof body.project === 'string' && /^[a-f0-9]{24}$/i.test(body.project) ? body.project : null);
  if (projectId) data.projectId = projectId;

  if (PERSONAL.test(e.resource)) {
    for (const c of connections) if (e.actor && String(c.user._id) === e.actor.id) send(c, 'change', data);
    return;
  }
  if (!projectId) {
    for (const c of connections) send(c, 'change', data);
    return;
  }
  await loadRoles();
  // Membership or project changes: re-read so access reflects the change itself.
  if (e.resource === 'projects' || e.resource === 'projects/members') projectCache.delete(projectId);
  const project = await projectDoc(projectId);
  for (const c of [...connections]) {
    await refreshUser(c);
    if (!connections.has(c)) continue;
    const allowed = project ? !!accessFor(project, c.user) : c.seen.has(projectId);
    if (!allowed) continue;
    c.seen.add(projectId);
    send(c, 'change', data);
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  subscribe((e) => dispatch(e));
}

liveStreamRouter.get('/stream', async (req, res) => {
  start();
  const key = String(req.query.ticket ?? '');
  const ticket = tickets.get(key);
  tickets.delete(key); // single use
  if (!ticket || ticket.expires < Date.now()) throw new HttpError(401, 'UNAUTHENTICATED', 'Live-update ticket is invalid or expired');
  const user = await User.findById(ticket.userId);
  if (!user || !user.isActive) throw new HttpError(401, 'UNAUTHENTICATED', 'Your account is not active');
  await loadRoles();
  await attachAccess(user);

  // Keep at most N streams per person (several tabs); close the oldest.
  const mine = [...connections].filter((c) => String(c.user._id) === String(user._id));
  for (const old of mine.slice(0, Math.max(0, mine.length - MAX_CONNECTIONS_PER_USER + 1))) close(old);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  res.write('retry: 5000\n\n');
  const conn: Connection = { user, res, loadedAt: Date.now(), seen: new Set() };
  connections.add(conn);
  send(conn, 'ready', { userId: String(user._id), at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    if (res.writableLength > MAX_BUFFERED_BYTES) return close(conn);
    res.write(`: ping ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    connections.delete(conn);
  });
});

/** For tests and health checks. */
export const liveStats = () => ({ connections: connections.size, tickets: tickets.size });
