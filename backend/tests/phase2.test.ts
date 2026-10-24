import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri('pms-phase2');
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app');
  app = createApp();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

type Task = { _id: string; name: string; number: number; status: string; type: string; assignee: string | null; start: string; percentComplete: number; parent: string | null; predecessors: unknown[]; relations: { task: string; type: string }[] };

describe('Phase 2 API', () => {
  let token: string;
  let userId: string;
  let otherToken: string;
  let otherId: string;
  let projectId: string;
  let catalog: { types: { _id: string; name: string }[]; statuses: { _id: string; name: string; isClosed: boolean }[] };
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const tasksUrl = () => `/api/projects/${projectId}/tasks`;
  const byName = (tasks: Task[], name: string) => tasks.find((t) => t.name === name)!;

  it('sets up users, catalog and a project with a key', async () => {
    const a = await request(app).post('/api/auth/register').send({ name: 'Alice Admin', email: 'a@example.com', password: 'password123' });
    const b = await request(app).post('/api/auth/register').send({ name: 'Bob Member', email: 'b@example.com', password: 'password123' });
    token = a.body.token;
    userId = a.body.user._id;
    otherToken = b.body.token;
    otherId = b.body.user._id;

    const ws = await request(app).get('/api/work-settings').set(auth());
    expect(ws.status).toBe(200);
    catalog = ws.body;
    expect(catalog.types.map((t) => t.name)).toContain('Milestone');
    expect(catalog.statuses.some((s) => s.isClosed)).toBe(true);

    const p = await request(app).post('/api/projects').set(auth()).send({ name: 'Office Fit Out', startDate: '2026-11-02' });
    projectId = p.body.project._id;
    expect(p.body.project.key).toBe('OFO');
  });

  it('numbers tasks, applies default type/status and closes tasks to 100%', async () => {
    await request(app).post(tasksUrl()).set(auth()).send({ name: 'Design', duration: 3 });
    const m = await request(app).post(tasksUrl()).set(auth()).send({ name: 'Approval', duration: 0 });
    const tasks: Task[] = m.body.tasks;
    expect(tasks.map((t) => t.number)).toEqual([1, 2]);
    const milestoneType = catalog.types.find((t) => t.name === 'Milestone')!._id;
    expect(byName(tasks, 'Approval').type).toBe(milestoneType);

    const closed = catalog.statuses.find((s) => s.isClosed)!._id;
    const upd = await request(app).patch(`${tasksUrl()}/${byName(tasks, 'Design')._id}`).set(auth()).send({ status: closed, assignee: userId });
    expect(upd.status).toBe(200);
    expect(byName(upd.body.tasks, 'Design')).toMatchObject({ status: closed, percentComplete: 100, assignee: userId });

    const bad = await request(app).patch(`${tasksUrl()}/${byName(tasks, 'Design')._id}`).set(auth()).send({ assignee: otherId });
    expect(bad.status).toBe(400); // Bob is not a member yet
  });

  it('supports manual scheduling and relations', async () => {
    let plan = await request(app).get(tasksUrl()).set(auth());
    const design = byName(plan.body.tasks, 'Design');
    const approval = byName(plan.body.tasks, 'Approval');
    plan = await request(app)
      .patch(`${tasksUrl()}/${approval._id}`)
      .set(auth())
      .send({ predecessors: [{ task: design._id, type: 'FS', lag: 0 }], relations: [{ task: design._id, type: 'blocks' }] });
    expect(byName(plan.body.tasks, 'Approval').start).toBe('2026-11-05');
    plan = await request(app).patch(`${tasksUrl()}/${approval._id}`).set(auth()).send({ manual: true, constraintStart: '2026-11-03' });
    expect(byName(plan.body.tasks, 'Approval')).toMatchObject({ start: '2026-11-03', relations: [{ task: design._id, type: 'blocks' }] });
  });

  it('bulk edits and bulk deletes', async () => {
    const plan = await request(app).get(tasksUrl()).set(auth());
    const ids = plan.body.tasks.map((t: Task) => t._id);
    const res = await request(app).post(`${tasksUrl()}/bulk`).set(auth()).send({ taskIds: ids, patch: { priority: 'high' } });
    expect(res.status).toBe(200);
    expect(res.body.tasks.every((t: { priority: string }) => t.priority === 'high')).toBe(true);

    const extra = await request(app).post(tasksUrl()).set(auth()).send({ name: 'Temp' });
    const del = await request(app).post(`${tasksUrl()}/bulk-delete`).set(auth()).send({ taskIds: [extra.body.createdTaskId] });
    expect(del.body.tasks.map((t: Task) => t.name)).toEqual(['Design', 'Approval']);
  });

  it('copies within a project and moves to another project', async () => {
    let plan = await request(app).get(tasksUrl()).set(auth());
    const ids = plan.body.tasks.map((t: Task) => t._id);
    const copy = await request(app).post(`${tasksUrl()}/transfer`).set(auth()).send({ taskIds: ids, targetProjectId: projectId, mode: 'copy' });
    expect(copy.status).toBe(200);
    expect(copy.body.tasks.map((t: Task) => t.name)).toEqual(['Design', 'Approval', 'Design (copy)', 'Approval (copy)']);
    const copiedApproval = byName(copy.body.tasks, 'Approval (copy)');
    expect(copiedApproval.predecessors).toHaveLength(1); // link re-pointed inside the copy
    expect(copiedApproval.number).toBe(5);

    const other = await request(app).post('/api/projects').set(auth()).send({ name: 'Second Site', startDate: '2026-11-02' });
    const otherProject = other.body.project._id;
    const copiedIds = copy.body.tasks.filter((t: Task) => t.name.endsWith('(copy)')).map((t: Task) => t._id);
    const move = await request(app).post(`${tasksUrl()}/transfer`).set(auth()).send({ taskIds: copiedIds, targetProjectId: otherProject, mode: 'move' });
    expect(move.body.tasks).toHaveLength(2);
    plan = await request(app).get(`/api/projects/${otherProject}/tasks`).set(auth());
    expect(plan.body.tasks.map((t: Task) => [t.name, t.number])).toEqual([['Design (copy)', 1], ['Approval (copy)', 2]]);

    // Bob can't transfer into a project he can't see
    const denied = await request(app).post(`/api/projects/${otherProject}/tasks/transfer`).set(auth(otherToken)).send({ taskIds: copiedIds, targetProjectId: projectId, mode: 'copy' });
    expect(denied.status).toBe(404);
  });

  it('saves private and public views with role checks', async () => {
    await request(app).post(`/api/projects/${projectId}/members`).set(auth()).send({ userId: otherId, role: 'member' });
    const config = { filters: [{ field: 'priority', op: 'in', value: ['high'] }], sort: [{ field: 'start', dir: 'asc' }], groupBy: 'status', columns: ['name', 'status'] };
    const mine = await request(app).post(`/api/projects/${projectId}/views`).set(auth(otherToken)).send({ name: 'My high', kind: 'table', config });
    expect(mine.status).toBe(201);
    const pub = await request(app).post(`/api/projects/${projectId}/views`).set(auth(otherToken)).send({ name: 'Shared', kind: 'board', isPublic: true, config });
    expect(pub.status).toBe(403);
    const shared = await request(app).post(`/api/projects/${projectId}/views`).set(auth()).send({ name: 'Team board', kind: 'board', isPublic: true, config });
    expect(shared.status).toBe(201);

    const aliceList = await request(app).get(`/api/projects/${projectId}/views`).set(auth());
    expect(aliceList.body.views.map((v: { name: string }) => v.name)).toEqual(['Team board']); // Bob's private view is hidden
    const bobList = await request(app).get(`/api/projects/${projectId}/views`).set(auth(otherToken));
    expect(bobList.body.views).toHaveLength(2);
    const del = await request(app).delete(`/api/projects/${projectId}/views/${shared.body.view._id}`).set(auth(otherToken));
    expect(del.status).toBe(403);
  });

  it('searches by name and readable ID', async () => {
    const byText = await request(app).get('/api/search?q=desi').set(auth());
    expect(byText.body.tasks.map((t: Task) => t.name)).toContain('Design');
    const byKey = await request(app).get('/api/search?q=OFO-2').set(auth());
    expect(byKey.body.tasks[0]).toMatchObject({ name: 'Approval', projectKey: 'OFO' });
    const projects = await request(app).get('/api/search?q=second').set(auth());
    expect(projects.body.projects[0].name).toBe('Second Site');
  });

  it('manages types, statuses, categories and project keys', async () => {
    const created = await request(app).post('/api/work-settings/statuses').set(auth()).send({ name: 'Blocked', color: '#ef4444' });
    expect(created.status).toBe(201);
    const forbidden = await request(app).post('/api/work-settings/types').set(auth(otherToken)).send({ name: 'Nope', color: '#000000' });
    expect(forbidden.status).toBe(403);
    const inUse = await request(app).delete(`/api/work-settings/types/${catalog.types.find((t) => t.name === 'Milestone')!._id}`).set(auth());
    expect(inUse.status).toBe(400);

    let res = await request(app).patch(`/api/projects/${projectId}`).set(auth()).send({ key: 'fit', categories: [{ name: 'Civil' }, { name: 'MEP' }] });
    expect(res.status).toBe(200);
    expect(res.body.project.key).toBe('FIT');
    const civil = res.body.project.categories.find((c: { name: string }) => c.name === 'Civil');
    const design = byName(res.body.tasks, 'Design');
    res = await request(app).patch(`${tasksUrl()}/${design._id}`).set(auth()).send({ category: civil._id });
    expect(byName(res.body.tasks, 'Design').category).toBe(civil._id);
    res = await request(app).patch(`/api/projects/${projectId}`).set(auth()).send({ categories: [{ name: 'MEP' }] });
    const plan = await request(app).get(tasksUrl()).set(auth());
    expect(byName(plan.body.tasks, 'Design').category).toBeNull();
  });
});
