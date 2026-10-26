import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import type { Server } from 'node:http';

let mongo: MongoMemoryServer;
let app: Express;
let server: Server;
let base: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri('pms-platform');
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app');
  app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 120_000);

afterAll(async () => {
  server?.closeAllConnections?.();
  server?.close();
  await mongoose.disconnect();
  await mongo?.stop();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens the SSE stream and collects parsed `change` events until stopped. */
async function openStream(token: string) {
  const ticket = (await request(app).post('/api/events/ticket').set(auth(token))).body.ticket as string;
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events/stream?ticket=${ticket}`, { signal: controller.signal });
  const events: { type: string; projectId: string | null; actor: { name: string } | null; body?: unknown }[] = [];
  let ready = false;
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (event === 'ready') ready = true;
          if (event === 'change' && data) events.push(JSON.parse(data));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  for (let i = 0; i < 50 && !ready; i++) await wait(20);
  return { res, ticket, events, close: () => controller.abort() };
}

describe('Platform: live updates and audit trail', () => {
  let admin: string;
  let bob: string;
  let carol: string;
  let bobId: string;
  let projectId: string;

  it('sets up people and a project', async () => {
    const reg = async (name: string, email: string) => (await request(app).post('/api/auth/register').send({ name, email, password: 'password123' })).body;
    const a = await reg('Alice Admin', 'alice@example.com');
    const b = await reg('Bob Builder', 'bob@example.com');
    const c = await reg('Carol Clerk', 'carol@example.com');
    [admin, bob, carol, bobId] = [a.token, b.token, c.token, b.user._id];
    projectId = (await request(app).post('/api/projects').set(auth(admin)).send({ name: 'Tower C', startDate: '2026-11-02' })).body.project._id;
    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ userId: bobId, role: 'member' });
  });

  it('streams events only to people who can see the project', async () => {
    expect((await fetch(`${base}/api/events/stream?ticket=nope`)).status).toBe(401);
    expect((await request(app).post('/api/events/ticket')).status).toBe(401);

    const bobStream = await openStream(bob);
    const carolStream = await openStream(carol);
    expect(bobStream.res.headers.get('content-type')).toContain('text/event-stream');
    // Tickets are single use.
    expect((await fetch(`${base}/api/events/stream?ticket=${bobStream.ticket}`)).status).toBe(401);

    await request(app).post(`/api/projects/${projectId}/tasks`).set(auth(admin)).send({ name: 'Facade', duration: 4 });
    await request(app).post('/api/groups').set(auth(admin)).send({ name: 'Crew', members: [] }); // org-level change
    await wait(400);

    const bobTask = bobStream.events.find((e) => e.type === 'task.created');
    expect(bobTask).toMatchObject({ projectId, actor: { name: 'Alice Admin' } });
    expect(bobTask).not.toHaveProperty('body');
    expect(carolStream.events.some((e) => e.type === 'task.created')).toBe(false);
    expect(carolStream.events.some((e) => e.type === 'group.created')).toBe(true);

    // Adding Carol to the project gives her the project's events from then on.
    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ userId: (await request(app).get('/api/auth/me').set(auth(carol))).body.user._id, role: 'viewer' });
    await request(app).post(`/api/projects/${projectId}/tasks`).set(auth(admin)).send({ name: 'Roof', duration: 2 });
    await wait(400);
    expect(carolStream.events.some((e) => e.type === 'task.created' && e.projectId === projectId)).toBe(true);
    bobStream.close();
    carolStream.close();
  });

  it('writes audit entries with readable summaries and redacted bodies', async () => {
    await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong-password' });
    await request(app).post('/api/auth/change-password').set(auth(admin)).send({ currentPassword: 'password123', newPassword: 'password456' });
    await wait(400);

    const all = await request(app).get('/api/audit?limit=200').set(auth(admin));
    expect(all.status).toBe(200);
    const created = all.body.entries.find((e: { type: string; summary: string }) => e.type === 'task.created' && e.summary.includes('Roof'));
    expect(created.summary).toMatch(/^Alice Admin created task .*Roof in Tower C$/);
    expect(all.body.entries.some((e: { type: string; category: string }) => e.type === 'auth.login_failed' && e.category === 'security')).toBe(true);
    const pw = all.body.entries.find((e: { resource: string }) => e.resource === 'auth/change-password');
    expect(JSON.stringify(pw.body)).not.toContain('password456');

    // Filters and cursor paging
    const tasks = await request(app).get('/api/audit?type=task.created').set(auth(admin));
    expect(tasks.body.entries.every((e: { type: string }) => e.type === 'task.created')).toBe(true);
    const page1 = await request(app).get('/api/audit?limit=2').set(auth(admin));
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await request(app).get(`/api/audit?limit=2&before=${page1.body.nextCursor}`).set(auth(admin));
    expect(page2.body.entries[0]._id).not.toBe(page1.body.entries[0]._id);
    const search = await request(app).get('/api/audit?q=facade').set(auth(admin));
    expect(search.body.entries.length).toBeGreaterThan(0);

    const stats = await request(app).get('/api/audit/stats').set(auth(admin));
    expect(stats.body.changesToday).toBeGreaterThan(0);
    expect(stats.body.failedLogins).toBeGreaterThanOrEqual(1);
  });

  it('limits the audit trail to admins and project managers', async () => {
    expect((await request(app).get('/api/audit').set(auth(bob))).status).toBe(403);
    expect((await request(app).get(`/api/audit?project=${projectId}`).set(auth(bob))).status).toBe(403); // member, not manager
    await request(app).patch(`/api/projects/${projectId}/members/${bobId}`).set(auth(admin)).send({ role: 'manager' });
    const scoped = await request(app).get(`/api/audit?project=${projectId}`).set(auth(bob));
    expect(scoped.status).toBe(200);
    expect(scoped.body.entries.length).toBeGreaterThan(0);
    expect(scoped.body.entries.every((e: { project: string; category: string }) => e.project === projectId && e.category === 'change')).toBe(true);
  });
});
