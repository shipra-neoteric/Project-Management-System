import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
let outbox: { to: string; subject: string; text: string }[];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('pms-phase13');
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app');
  outbox = (await import('../src/services/mailer')).outbox;
  app = createApp();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

type Task = { _id: string; name: string; status: string; watchers: string[]; customValues: Record<string, unknown>; start: string; baselineStart: string | null };
const tokenFrom = (text: string) => /token=([a-f0-9]{64})/.exec(text)?.[1] ?? '';

describe('Phase 1 & 3 API', () => {
  let alice: string;
  let aliceId: string;
  let bob: string;
  let bobId: string;
  let projectId: string;
  let taskId: string;
  let catalog: { statuses: { _id: string; name: string; isClosed: boolean }[]; phases: { _id: string; name: string }[] };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tasks = () => `/api/projects/${projectId}/tasks`;

  it('registers users and sends verification emails', async () => {
    const a = await request(app).post('/api/auth/register').send({ name: 'Alice Admin', email: 'alice@example.com', password: 'password123' });
    const b = await request(app).post('/api/auth/register').send({ name: 'Bob Builder', email: 'bob@example.com', password: 'password123' });
    alice = a.body.token;
    aliceId = a.body.user._id;
    bob = b.body.token;
    bobId = b.body.user._id;
    expect(a.body.user.emailVerified).toBe(false);
    const mail = outbox.find((m) => m.to === 'bob@example.com' && m.subject.includes('Confirm'))!;
    const verify = await request(app).post('/api/auth/verify-email').send({ token: tokenFrom(mail.text) });
    expect(verify.body.user.emailVerified).toBe(true);
  });

  it('resets a forgotten password with a one-time link', async () => {
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(200); // never reveals whether the account exists
    await request(app).post('/api/auth/forgot-password').send({ email: 'bob@example.com' });
    const mail = [...outbox].reverse().find((m) => m.subject === 'Reset your password')!;
    const token = tokenFrom(mail.text);
    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'brand-new-pass' });
    expect(reset.status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'again-again' })).status).toBe(400);
    const login = await request(app).post('/api/auth/login').send({ email: 'bob@example.com', password: 'brand-new-pass' });
    bob = login.body.token;
    expect(login.status).toBe(200);
  });

  it('records history, comments with mentions and notifies watchers', async () => {
    const p = await request(app).post('/api/projects').set(auth(alice)).send({ name: 'Tower Fit Out', startDate: '2026-11-02' });
    projectId = p.body.project._id;
    await request(app).post(`/api/projects/${projectId}/members`).set(auth(alice)).send({ userId: bobId, role: 'member' });
    const t = await request(app).post(tasks()).set(auth(alice)).send({ name: 'Survey', duration: 2 });
    taskId = t.body.createdTaskId;
    expect(t.body.tasks[0].watchers).toEqual([aliceId]);

    await request(app).patch(`${tasks()}/${taskId}`).set(auth(alice)).send({ duration: 4, assignee: bobId });
    const bobNotes = await request(app).get('/api/notifications').set(auth(bob));
    expect(bobNotes.body.notifications[0]).toMatchObject({ reason: 'assigned', taskName: 'Survey' });

    const comment = await request(app)
      .post(`${tasks()}/${taskId}/comments`)
      .set(auth(bob))
      .send({ text: `Started. @[Alice Admin](${aliceId}) please review` });
    expect(comment.status).toBe(201);
    const aliceNotes = await request(app).get('/api/notifications?unread=1').set(auth(alice));
    expect(aliceNotes.body.notifications[0]).toMatchObject({ reason: 'mentioned' });
    expect(outbox.some((m) => m.to === 'alice@example.com' && m.subject.includes('mentioned you'))).toBe(true);

    const activity = await request(app).get(`${tasks()}/${taskId}/activity`).set(auth(alice));
    const kinds = activity.body.activity.map((j: { kind: string }) => j.kind);
    expect(kinds).toEqual(['created', 'change', 'comment']);
    const change = activity.body.activity[1].changes.map((c: { label: string; to: string }) => `${c.label}=${c.to}`);
    expect(change).toEqual(expect.arrayContaining(['Duration=4 days', 'Assignee=Bob Builder']));
    expect(activity.body.watchers).toEqual(expect.arrayContaining([aliceId, bobId]));

    const editOther = await request(app).patch(`${tasks()}/${taskId}/comments/${comment.body.journal._id}`).set(auth(alice)).send({ text: 'hijack' });
    expect(editOther.status).toBe(403);
    const read = await request(app).post('/api/notifications/read').set(auth(alice)).send({ all: true });
    expect(read.body.unreadCount).toBe(0);

    const projectActivity = await request(app).get(`/api/projects/${projectId}/activity`).set(auth(alice));
    expect(projectActivity.body.activity[0].kind).toBe('comment');
  });

  it('uploads, downloads and deletes attachments', async () => {
    const up = await request(app).post(`${tasks()}/${taskId}/attachments`).set(auth(bob)).attach('file', Buffer.from('hello plan'), 'notes.txt');
    expect(up.status).toBe(201);
    const list = await request(app).get(`${tasks()}/${taskId}/attachments`).set(auth(alice));
    expect(list.body.attachments[0]).toMatchObject({ filename: 'notes.txt', size: 10 });
    const down = await request(app).get(`${tasks()}/${taskId}/attachments/${up.body.attachment._id}`).set(auth(alice)).buffer(true).parse((res, cb) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString()));
      res.on('end', () => cb(null, data));
    });
    expect(down.headers['content-disposition']).toContain('attachment');
    expect(down.body).toBe('hello plan');
    const del = await request(app).delete(`${tasks()}/${taskId}/attachments/${up.body.attachment._id}`).set(auth(alice));
    expect(del.status).toBe(204);
  });

  it('enforces status workflows for restricted roles', async () => {
    const ws = await request(app).get('/api/work-settings').set(auth(alice));
    catalog = ws.body;
    const byName = (n: string) => catalog.statuses.find((s) => s.name === n)!._id;
    // Members may only go New → In progress.
    const put = await request(app).put('/api/work-settings/workflow').set(auth(alice)).send({ member: { [byName('New')]: [byName('In progress')] } });
    expect(put.status).toBe(200);
    const denied = await request(app).patch(`${tasks()}/${taskId}`).set(auth(bob)).send({ status: byName('Closed') });
    expect(denied.status).toBe(400);
    expect(denied.body.error.message).toContain('workflow');
    const ok = await request(app).patch(`${tasks()}/${taskId}`).set(auth(bob)).send({ status: byName('In progress') });
    expect(ok.status).toBe(200);
    const owner = await request(app).patch(`${tasks()}/${taskId}`).set(auth(alice)).send({ status: byName('Closed') });
    expect(owner.status).toBe(200); // owners are never restricted
    await request(app).put('/api/work-settings/workflow').set(auth(alice)).send({ member: null });
  });

  it('supports task and project custom fields', async () => {
    let ws = await request(app).post('/api/work-settings/custom-fields').set(auth(alice)).send({ name: 'Cost centre', scope: 'task', kind: 'select', options: [{ name: 'CAPEX' }, { name: 'OPEX' }] });
    expect(ws.status).toBe(201);
    const field = ws.body.customFields.find((f: { name: string }) => f.name === 'Cost centre');
    const capex = field.options[0]._id;
    const bad = await request(app).patch(`${tasks()}/${taskId}`).set(auth(alice)).send({ customValues: { [field._id]: 'nope' } });
    expect(bad.status).toBe(400);
    const good = await request(app).patch(`${tasks()}/${taskId}`).set(auth(alice)).send({ customValues: { [field._id]: capex } });
    expect(good.body.tasks[0].customValues[field._id]).toBe(capex);

    ws = await request(app).post('/api/work-settings/custom-fields').set(auth(alice)).send({ name: 'Budget (INR)', scope: 'project', kind: 'number' });
    const budget = ws.body.customFields.find((f: { name: string }) => f.name === 'Budget (INR)');
    const proj = await request(app).patch(`/api/projects/${projectId}`).set(auth(alice)).send({ customValues: { [budget._id]: '2500000' } });
    expect(proj.body.project.customValues[budget._id]).toBe(2500000);

    const del = await request(app).delete(`/api/work-settings/custom-fields/${field._id}`).set(auth(alice));
    expect(del.status).toBe(200);
    const plan = await request(app).get(tasks()).set(auth(alice));
    expect(plan.body.tasks[0].customValues[field._id]).toBeUndefined();
  });

  it('builds programs with sub-projects, roll-ups and an overview', async () => {
    const program = await request(app).post('/api/projects').set(auth(alice)).send({ name: 'Expansion Program', startDate: '2026-11-02', kind: 'program' });
    const programId = program.body.project._id;
    const moved = await request(app).patch(`/api/projects/${projectId}`).set(auth(alice)).send({ parent: programId });
    expect(moved.status).toBe(200);
    const cycle = await request(app).patch(`/api/projects/${programId}`).set(auth(alice)).send({ parent: projectId });
    expect(cycle.status).toBe(400);

    const list = await request(app).get('/api/projects').set(auth(alice));
    const prog = list.body.projects.find((p: { _id: string }) => p._id === programId);
    expect(prog.rollup).toMatchObject({ projectCount: 1, taskCount: 1, percentComplete: 100 });

    const overview = await request(app).get(`/api/projects/${programId}/overview`).set(auth(alice));
    expect(overview.body.children.map((c: { name: string }) => c.name)).toEqual(['Tower Fit Out']);
    expect(overview.body.counts.status.reduce((a: number, s: { count: number }) => a + s.count, 0)).toBe(1);
  });

  it('copies projects and templates with re-planned dates', async () => {
    await request(app).patch(`/api/projects/${projectId}`).set(auth(alice)).send({ isTemplate: true, categories: [{ name: 'Civil' }] });
    // Bob (member) can see templates of other people and start a project from one
    const created = await request(app)
      .post('/api/projects')
      .set(auth(bob))
      .send({ name: 'Bob Site', startDate: '2026-12-07', fromProject: projectId, copy: { tasks: true, resources: true, members: false, views: true } });
    expect(created.status).toBe(201);
    const plan = await request(app).get(`/api/projects/${created.body.project._id}/tasks`).set(auth(bob));
    expect(plan.body.tasks).toHaveLength(1);
    expect(plan.body.tasks[0].start).toBe('2026-12-07');
    expect(plan.body.project.categories.map((c: { name: string }) => c.name)).toEqual(['Civil']);
    expect(plan.body.project.myRole).toBe('owner');
  });

  it('keeps several baselines', async () => {
    await request(app).patch(`/api/projects/${projectId}`).set(auth(alice)).send({ isTemplate: false });
    const b1 = await request(app).post(`/api/projects/${projectId}/baselines`).set(auth(alice)).send({ name: 'Approved plan' });
    expect(b1.status).toBe(201);
    await request(app).patch(`${tasks()}/${taskId}`).set(auth(alice)).send({ duration: 6 });
    await request(app).post(`/api/projects/${projectId}/baselines`).set(auth(alice)).send({ name: 'Re-plan' });
    const list = await request(app).get(`/api/projects/${projectId}/baselines`).set(auth(alice));
    expect(list.body.baselines.map((b: { name: string }) => b.name)).toEqual(['Re-plan', 'Approved plan']);
    const one = await request(app).get(`/api/projects/${projectId}/baselines/${b1.body.baseline._id}`).set(auth(alice));
    expect(one.body.baseline.tasks[0]).toMatchObject({ start: '2026-11-02', finish: '2026-11-05' });
  });

  it('sets life-cycle phases, favorites and saved project lists', async () => {
    const phases = catalog.phases;
    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set(auth(alice))
      .send({ lifecycle: [{ definition: phases[0]._id, start: '2026-11-02', finish: '2026-11-20', gateStatus: 'passed' }] });
    expect(res.body.project.lifecycle[0]).toMatchObject({ gateStatus: 'passed' });

    await request(app).post(`/api/projects/${projectId}/favorite`).set(auth(alice));
    const me = await request(app).get('/api/auth/me').set(auth(alice));
    expect(me.body.user.favorites).toEqual([projectId]);

    const view = await request(app).post('/api/project-views').set(auth(bob)).send({ name: 'Mine', config: { filters: [{ field: 'status', op: 'in', value: ['active'] }] } });
    expect(view.status).toBe(201);
    const shared = await request(app).post('/api/project-views').set(auth(bob)).send({ name: 'All', isPublic: true, config: {} });
    expect(shared.status).toBe(403);
  });

  it('records only the fields that really changed', async () => {
    await request(app).patch(`${tasks()}/${taskId}`).set(auth(alice)).send({ priority: 'immediate' });
    const activity = await request(app).get(`${tasks()}/${taskId}/activity`).set(auth(alice));
    const last = activity.body.activity.at(-1);
    expect(last.changes).toEqual([{ field: 'priority', label: 'Priority', from: 'Normal', to: 'Immediate' }]);
  });

  it('makes archived projects read-only', async () => {
    await request(app).patch(`/api/projects/${projectId}`).set(auth(alice)).send({ status: 'archived' });
    const edit = await request(app).post(tasks()).set(auth(alice)).send({ name: 'Nope' });
    expect(edit.status).toBe(403);
    const rename = await request(app).patch(`/api/projects/${projectId}`).set(auth(alice)).send({ name: 'Renamed' });
    expect(rename.status).toBe(403);
    const read = await request(app).get(tasks()).set(auth(bob));
    expect(read.status).toBe(200);
    const unarchive = await request(app).patch(`/api/projects/${projectId}`).set(auth(alice)).send({ status: 'active' });
    expect(unarchive.status).toBe(200);
  });
});
