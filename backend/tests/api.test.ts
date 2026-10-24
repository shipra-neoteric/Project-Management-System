import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri('pms-test');
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app');
  app = createApp();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function register(name: string, email: string) {
  const res = await request(app).post('/api/auth/register').send({ name, email, password: 'password123' });
  expect(res.status).toBe(201);
  return res.body as { token: string; user: { _id: string; role: string } };
}

describe('API', () => {
  let admin: { token: string; user: { _id: string; role: string } };
  let bob: { token: string; user: { _id: string; role: string } };
  let projectId: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('makes the first user an Admin and later users regular users', async () => {
    admin = await register('Alice Admin', 'alice@example.com');
    bob = await register('Bob Builder', 'bob@example.com');
    expect(admin.user.role).toBe('Admin');
    expect(bob.user.role).toBe('User');
    const dup = await request(app).post('/api/auth/register').send({ name: 'X', email: 'alice@example.com', password: 'password123' });
    expect(dup.status).toBe(400); // name too short → validation first
    const login = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong' });
    expect(login.status).toBe(401);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('creates a project and schedules linked tasks', async () => {
    const created = await request(app)
      .post('/api/projects')
      .set(auth(admin.token))
      .send({ name: 'Office Fit-out', startDate: '2026-11-02' });
    expect(created.status).toBe(201);
    projectId = created.body.project._id;
    expect(created.body.project.myRole).toBe('owner');

    const a = await request(app).post(`/api/projects/${projectId}/tasks`).set(auth(admin.token)).send({ name: 'Design', duration: 3 });
    const b = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set(auth(admin.token))
      .send({ name: 'Build', duration: 3, afterTaskId: a.body.createdTaskId });
    expect(b.status).toBe(201);

    const linked = await request(app)
      .patch(`/api/projects/${projectId}/tasks/${b.body.createdTaskId}`)
      .set(auth(admin.token))
      .send({ predecessors: [{ task: a.body.createdTaskId, type: 'FS', lag: 0 }] });
    expect(linked.status).toBe(200);
    const build = linked.body.tasks.find((t: { name: string }) => t.name === 'Build');
    expect(build).toMatchObject({ start: '2026-11-05', finish: '2026-11-09', rowNumber: 2, isCritical: true });
    expect(linked.body.project.finishDate).toBe('2026-11-09');

    // Cycle is rejected and nothing is saved
    const cycle = await request(app)
      .patch(`/api/projects/${projectId}/tasks/${a.body.createdTaskId}`)
      .set(auth(admin.token))
      .send({ predecessors: [{ task: b.body.createdTaskId, type: 'FS', lag: 0 }] });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.code).toBe('SCHEDULE_ERROR');
  });

  it('indents a task under a summary and rolls up dates', async () => {
    const phase = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set(auth(admin.token))
      .send({ name: 'Phase 1', duration: 1 });
    // Move Phase 1 to the top, then indent Design & Build under it
    await request(app).post(`/api/projects/${projectId}/tasks/${phase.body.createdTaskId}/move`).set(auth(admin.token)).send({ action: 'up' });
    let plan = await request(app).post(`/api/projects/${projectId}/tasks/${phase.body.createdTaskId}/move`).set(auth(admin.token)).send({ action: 'up' });
    expect(plan.body.tasks[0].name).toBe('Phase 1');
    for (const name of ['Design', 'Build']) {
      const id = plan.body.tasks.find((t: { name: string }) => t.name === name)._id;
      plan = await request(app).post(`/api/projects/${projectId}/tasks/${id}/move`).set(auth(admin.token)).send({ action: 'indent' });
      expect(plan.status).toBe(200);
    }
    const summary = plan.body.tasks[0];
    expect(summary).toMatchObject({ name: 'Phase 1', isSummary: true, start: '2026-11-02', finish: '2026-11-09', duration: 6 });
    expect(plan.body.tasks.map((t: { wbs: string }) => t.wbs)).toEqual(['1', '1.1', '1.2']);
  });

  it('enforces project roles', async () => {
    const hidden = await request(app).get(`/api/projects/${projectId}`).set(auth(bob.token));
    expect(hidden.status).toBe(404);

    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin.token)).send({ userId: bob.user._id, role: 'viewer' });
    const visible = await request(app).get(`/api/projects/${projectId}/tasks`).set(auth(bob.token));
    expect(visible.status).toBe(200);
    expect(visible.body.project.myRole).toBe('viewer');

    const edit = await request(app).post(`/api/projects/${projectId}/tasks`).set(auth(bob.token)).send({ name: 'Nope' });
    expect(edit.status).toBe(403);

    await request(app).patch(`/api/projects/${projectId}/members/${bob.user._id}`).set(auth(admin.token)).send({ role: 'member' });
    const allowed = await request(app).post(`/api/projects/${projectId}/tasks`).set(auth(bob.token)).send({ name: 'Snagging', duration: 2 });
    expect(allowed.status).toBe(201);

    const del = await request(app).delete(`/api/projects/${projectId}`).set(auth(bob.token));
    expect(del.status).toBe(403);
  });

  it('manages resources, baseline, calendar and dashboard', async () => {
    const r = await request(app).post(`/api/projects/${projectId}/resources`).set(auth(admin.token)).send({ name: 'Priya', title: 'Architect' });
    expect(r.status).toBe(201);
    let plan = await request(app).get(`/api/projects/${projectId}/tasks`).set(auth(admin.token));
    const design = plan.body.tasks.find((t: { name: string }) => t.name === 'Design');
    const assigned = await request(app)
      .patch(`/api/projects/${projectId}/tasks/${design._id}`)
      .set(auth(admin.token))
      .send({ resources: [r.body.resource._id], percentComplete: 100 });
    expect(assigned.body.tasks.find((t: { name: string }) => t.name === 'Design').resources).toHaveLength(1);

    const base = await request(app).post(`/api/projects/${projectId}/baseline`).set(auth(admin.token));
    expect(base.body.tasks.every((t: { baselineStart: string }) => !!t.baselineStart)).toBe(true);

    // Make Wednesday 2026-11-04 a holiday: Design now finishes Thursday
    plan = await request(app).patch(`/api/projects/${projectId}`).set(auth(admin.token)).send({ holidays: ['2026-11-04'] });
    expect(plan.status).toBe(200);
    expect(plan.body.tasks.find((t: { name: string }) => t.name === 'Design').finish).toBe('2026-11-05');

    const delRes = await request(app).delete(`/api/projects/${projectId}/resources/${r.body.resource._id}`).set(auth(admin.token));
    expect(delRes.status).toBe(204);

    const dash = await request(app).get('/api/dashboard').set(auth(admin.token));
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.projects).toBe(1);

    const list = await request(app).get('/api/projects').set(auth(admin.token));
    expect(list.body.projects[0].stats.taskCount).toBe(3);
  });

  it('deletes a summary with its subtree', async () => {
    const plan = await request(app).get(`/api/projects/${projectId}/tasks`).set(auth(admin.token));
    const res = await request(app).delete(`/api/projects/${projectId}/tasks/${plan.body.tasks[0]._id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t: { name: string }) => t.name)).toEqual(['Snagging']);
  });
});
