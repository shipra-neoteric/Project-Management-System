import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
let outbox: { to: string; subject: string; text: string }[];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri('pms-phase45');
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

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
type Task = { _id: string; name: string; percentComplete: number; work: number | null; remainingWork: number | null; spentHours: number; assignee: string | null };

describe('Phase 4 & 5 API', () => {
  let admin: string;
  let adminId: string;
  let bob: string;
  let bobId: string;
  let carol: string;
  let carolId: string;
  let projectId: string;
  let taskId: string;
  let ws: { statuses: { _id: string; name: string }[]; activities: { _id: string; name: string }[] };
  const tasksUrl = () => `/api/projects/${projectId}/tasks`;

  it('sets up users, a project and a task', async () => {
    const reg = async (name: string, email: string) => (await request(app).post('/api/auth/register').send({ name, email, password: 'password123' })).body;
    const a = await reg('Alice Admin', 'alice@example.com');
    const b = await reg('Bob Builder', 'bob@example.com');
    const c = await reg('Carol Clerk', 'carol@example.com');
    [admin, adminId, bob, bobId, carol, carolId] = [a.token, a.user._id, b.token, b.user._id, c.token, c.user._id];
    const p = await request(app).post('/api/projects').set(auth(admin)).send({ name: 'Tower B', startDate: '2026-11-02' });
    projectId = p.body.project._id;
    const t = await request(app).post(tasksUrl()).set(auth(admin)).send({ name: 'Partitions', duration: 5 });
    taskId = t.body.createdTaskId;
    ws = (await request(app).get('/api/work-settings').set(auth(admin))).body;
    expect(ws.activities.length).toBeGreaterThan(0);
  });

  // ---- Phase 5: roles, groups, global roles, placeholders, invitations -------------------

  it('supports custom project roles', async () => {
    const roles = await request(app).get('/api/roles').set(auth(bob));
    expect(roles.body.roles.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(['manager', 'member', 'viewer']));
    const created = await request(app).post('/api/roles').set(auth(admin)).send({ name: 'Timekeeper', permissions: ['log_time', 'view_time'] });
    expect(created.status).toBe(201);
    const roleId = created.body.role._id;
    expect(created.body.role.permissions).toContain('view_project');
    expect((await request(app).post('/api/roles').set(auth(bob)).send({ name: 'Nope', permissions: [] })).status).toBe(403);

    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ userId: bobId, role: roleId });
    const plan = await request(app).get(tasksUrl()).set(auth(bob));
    expect(plan.body.project).toMatchObject({ myRole: roleId, myRoleName: 'Timekeeper' });
    expect(plan.body.project.myPermissions).toEqual(expect.arrayContaining(['view_project', 'log_time']));
    const edit = await request(app).post(tasksUrl()).set(auth(bob)).send({ name: 'Not allowed' });
    expect(edit.status).toBe(403);
    const log = await request(app).post('/api/time-entries').set(auth(bob)).send({ project: projectId, task: taskId, date: '2026-11-03', hours: 2 });
    expect(log.status).toBe(201);
    expect((await request(app).delete(`/api/roles/${roleId}`).set(auth(admin))).status).toBe(400); // in use
  });

  it('gives group members access through the group', async () => {
    const g = await request(app).post('/api/groups').set(auth(admin)).send({ name: 'Site team', members: [carolId] });
    expect(g.status).toBe(201);
    expect((await request(app).get(tasksUrl()).set(auth(carol))).status).toBe(404);
    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ groupId: g.body.group._id, role: 'member' });
    const plan = await request(app).get(tasksUrl()).set(auth(carol));
    expect(plan.status).toBe(200);
    expect(plan.body.project.myRole).toBe('member');
    // group members are assignable
    const assign = await request(app).patch(`${tasksUrl()}/${taskId}`).set(auth(admin)).send({ assignee: carolId });
    expect(assign.status).toBe(200);
  });

  it('controls project creation with global roles', async () => {
    const roles = await request(app).get('/api/global-roles').set(auth(admin));
    const everyone = roles.body.roles.find((r: { isDefault: boolean }) => r.isDefault);
    await request(app).patch(`/api/global-roles/${everyone._id}`).set(auth(admin)).send({ permissions: [] });
    expect((await request(app).post('/api/projects').set(auth(bob)).send({ name: 'X', startDate: '2026-11-02' })).status).toBe(403);

    const pmo = await request(app).post('/api/global-roles').set(auth(admin)).send({ name: 'PMO', permissions: ['create_projects', 'view_all_projects'] });
    await request(app).patch(`/api/users/${bobId}`).set(auth(admin)).send({ globalRoles: [pmo.body.role._id] });
    expect((await request(app).post('/api/projects').set(auth(bob)).send({ name: 'Bob plan', startDate: '2026-11-02' })).status).toBe(201);
    // view_all_projects: Bob sees Carol-only projects read-only
    const carolProject = await request(app).post('/api/projects').set(auth(admin)).send({ name: 'Private', startDate: '2026-11-02' });
    const seen = await request(app).get(`/api/projects/${carolProject.body.project._id}`).set(auth(bob));
    expect(seen.status).toBe(200);
    expect(seen.body.project.myPermissions).not.toContain('edit_tasks');
    await request(app).patch(`/api/global-roles/${everyone._id}`).set(auth(admin)).send({ permissions: ['create_projects'] });
  });

  it('creates placeholders, assigns them and replaces them with a real user', async () => {
    const ph = await request(app).post('/api/users/placeholders').set(auth(admin)).send({ name: 'Electrician (TBD)' });
    expect(ph.status).toBe(201);
    const phId = ph.body.user._id;
    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ userId: phId, role: 'member' });
    const t = await request(app).post(tasksUrl()).set(auth(admin)).send({ name: 'Wiring', duration: 3, assignee: phId });
    expect(t.body.tasks.find((x: Task) => x.name === 'Wiring').assignee).toBe(phId);

    const dan = await request(app).post('/api/auth/register').send({ name: 'Dan Sparks', email: 'dan@example.com', password: 'password123' });
    const rep = await request(app).post(`/api/users/${phId}/replace`).set(auth(admin)).send({ userId: dan.body.user._id });
    expect(rep.status).toBe(200);
    const plan = await request(app).get(tasksUrl()).set(auth(admin));
    expect(plan.body.tasks.find((x: Task) => x.name === 'Wiring').assignee).toBe(dan.body.user._id);
    expect(plan.body.project.members.some((m: { user: { _id: string } | null }) => m.user?._id === dan.body.user._id)).toBe(true);
  });

  it('invites people by email into a project', async () => {
    const inv = await request(app).post('/api/users/invite').set(auth(admin)).send({ email: 'erin@example.com', projectId, role: 'viewer' });
    expect(inv.status).toBe(201);
    expect(inv.body.user.invited).toBe(true);
    expect((await request(app).post('/api/auth/register').send({ name: 'Erin', email: 'erin@example.com', password: 'password123' })).status).toBe(409);
    const mail = [...outbox].reverse().find((m) => m.to === 'erin@example.com')!;
    const token = /token=([a-f0-9]{64})/.exec(mail.text)![1];
    expect((await request(app).get(`/api/auth/invite?token=${token}`)).body.email).toBe('erin@example.com');
    const accepted = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Erin Estimator', password: 'password123' });
    expect(accepted.status).toBe(200);
    const plan = await request(app).get(tasksUrl()).set(auth(accepted.body.token));
    expect(plan.body.project.myRole).toBe('viewer');
  });

  // ---- Phase 4: time, rates, costs, budgets, reports, progress modes --------------------

  it('prices time with default and project rates', async () => {
    let r = await request(app).post('/api/rates').set(auth(admin)).send({ user: adminId, rate: 1000, validFrom: '2026-01-01' });
    expect(r.status).toBe(201);
    expect((await request(app).post('/api/rates').set(auth(bob)).send({ user: bobId, rate: 1, validFrom: '2026-01-01' })).status).toBe(403);
    const e1 = await request(app).post('/api/time-entries').set(auth(admin)).send({ project: projectId, task: taskId, date: '2026-11-04', hours: 3, activity: ws.activities[0]._id });
    expect(e1.body.entry).toMatchObject({ rate: 1000, cost: 3000 });
    r = await request(app).post(`/api/projects/${projectId}/rates`).set(auth(admin)).send({ user: adminId, rate: 1500, validFrom: '2026-11-01' });
    expect(r.status).toBe(201);
    const list = await request(app).get(`/api/time-entries?project=${projectId}`).set(auth(admin));
    expect(list.body.entries.find((e: { _id: string }) => e._id === e1.body.entry._id)).toMatchObject({ rate: 1500, cost: 4500 }); // re-priced
  });

  it('upserts timesheet cells and limits visibility', async () => {
    const cell = { project: projectId, task: taskId, activity: ws.activities[1]._id, date: '2026-11-05' };
    await request(app).put('/api/time-entries/cell').set(auth(admin)).send({ ...cell, hours: 4 });
    await request(app).put('/api/time-entries/cell').set(auth(admin)).send({ ...cell, hours: 6 });
    let mine = await request(app).get('/api/time-entries?from=2026-11-05&to=2026-11-05').set(auth(admin));
    expect(mine.body.entries.map((e: { hours: number }) => e.hours)).toEqual([6]);
    await request(app).put('/api/time-entries/cell').set(auth(admin)).send({ ...cell, hours: 0 });
    mine = await request(app).get('/api/time-entries?from=2026-11-05&to=2026-11-05').set(auth(admin));
    expect(mine.body.entries).toHaveLength(0);

    // Carol (member via group, has view_time) sees all; Erin (viewer) only her own (none)
    const carolView = await request(app).get(`/api/time-entries?project=${projectId}`).set(auth(carol));
    expect(carolView.body.entries.length).toBeGreaterThanOrEqual(2);
    expect(carolView.body.entries[0].cost).toBeNull(); // members can't see costs
  });

  it('tracks material costs and budgets', async () => {
    const ws2 = await request(app).post('/api/work-settings/cost-types').set(auth(admin)).send({ name: 'Gypsum board', unit: 'sheet', unitRate: 450 });
    const typeId = ws2.body.costTypes.find((t: { name: string }) => t.name === 'Gypsum board')._id;
    const budget = await request(app)
      .post(`/api/projects/${projectId}/budgets`)
      .set(auth(admin))
      .send({ name: 'Partitions budget', labor: [{ label: 'Site engineer', hours: 10, rate: 1500 }], material: [{ costType: typeId, units: 100 }] });
    expect(budget.status).toBe(201);
    const budgetId = budget.body.budget._id;
    await request(app).patch(`${tasksUrl()}/${taskId}`).set(auth(admin)).send({ budget: budgetId });
    const ce = await request(app).post(`/api/projects/${projectId}/cost-entries`).set(auth(admin)).send({ costType: typeId, units: 20, date: '2026-11-06', task: taskId });
    expect((await request(app).get(`/api/projects/${projectId}/cost-entries`).set(auth(admin))).body.entries).toHaveLength(1);
    expect((await request(app).get(`/api/projects/${projectId}/cost-entries`).set(auth(bob))).status).toBe(403); // Timekeeper: no cost permissions
    expect(ce.body.entry.cost).toBe(9000);

    const list = await request(app).get(`/api/projects/${projectId}/budgets`).set(auth(admin));
    const s = list.body.budgets[0].summary;
    expect(s).toMatchObject({ plannedLabor: 15000, plannedMaterial: 45000, planned: 60000, actualMaterial: 9000 });
    expect(s.actualLabor).toBeGreaterThan(0); // time logged on the linked task
    expect(s.percentUsed).toBeGreaterThan(0);
  });

  it('reports time and cost grouped in different ways', async () => {
    const byUser = await request(app).get(`/api/projects/${projectId}/reports?kind=time&groupBy=user`).set(auth(admin));
    expect(byUser.status).toBe(200);
    expect(byUser.body.rows.map((r: { label: string }) => r.label)).toEqual(expect.arrayContaining(['Alice Admin', 'Bob Builder']));
    expect(byUser.body.totals.hours).toBe(5);
    const byType = await request(app).get(`/api/projects/${projectId}/reports?kind=cost&groupBy=costType`).set(auth(admin));
    expect(byType.body.rows[0]).toMatchObject({ label: 'Gypsum board', cost: 9000 });
    expect((await request(app).get(`/api/projects/${projectId}/reports?kind=cost`).set(auth(carol))).status).toBe(403);
  });

  it('derives progress from work or status and returns spent hours', async () => {
    await request(app).patch(`/api/projects/${projectId}`).set(auth(admin)).send({ progressMode: 'work' });
    let plan = await request(app).patch(`${tasksUrl()}/${taskId}`).set(auth(admin)).send({ work: 40, remainingWork: 10 });
    let task = plan.body.tasks.find((t: Task) => t._id === taskId);
    expect(task).toMatchObject({ work: 40, remainingWork: 10, percentComplete: 75 });
    expect(task.spentHours).toBe(5);

    await request(app).patch(`/api/projects/${projectId}`).set(auth(admin)).send({ progressMode: 'status' });
    const inProgress = ws.statuses.find((s) => s.name === 'In progress')!._id;
    plan = await request(app).patch(`${tasksUrl()}/${taskId}`).set(auth(admin)).send({ status: inProgress });
    task = plan.body.tasks.find((t: Task) => t._id === taskId);
    expect(task.percentComplete).toBe(50);
  });

  it('plans capacity with working hours and time off', async () => {
    await request(app).patch('/api/auth/me').set(auth(carol)).send({ workSchedule: { hoursPerDay: 6, workingDays: [1, 2, 3, 4, 5] } });
    await request(app).post('/api/time-off').set(auth(carol)).send({ start: '2026-11-03', end: '2026-11-03', note: 'Dentist' });
    const planner = await request(app).get('/api/planner?from=2026-11-02&to=2026-11-08').set(auth(admin));
    expect(planner.status).toBe(200);
    const cap = planner.body.capacity[carolId];
    expect(cap.slice(0, 7)).toEqual([6, 0, 6, 6, 6, 0, 0]); // Tue off, weekend off
    // Carol is assigned "Partitions" (5 days, 10h remaining) and is off on Tuesday → 2.5h on the other 4 days
    expect(planner.body.allocation[carolId].slice(0, 5)).toEqual([2.5, 0, 2.5, 2.5, 2.5]);

    // Team planner: only this project's people
    const team = await request(app).get(`/api/planner?from=2026-11-02&to=2026-11-08&project=${projectId}`).set(auth(admin));
    expect(team.status).toBe(200);
    expect(team.body.users.map((u: { _id: string }) => String(u._id))).toEqual(expect.arrayContaining([adminId, carolId]));
  });

  it('removes time, costs and budgets with the project', async () => {
    const extra = (await request(app).post('/api/projects').set(auth(admin)).send({ name: 'Scratch', startDate: '2026-11-02' })).body.project._id;
    await request(app).post('/api/time-entries').set(auth(admin)).send({ project: extra, date: '2026-11-03', hours: 1 });
    await request(app).post(`/api/projects/${extra}/budgets`).set(auth(admin)).send({ name: 'B', labor: [], material: [] });
    expect((await request(app).delete(`/api/projects/${extra}`).set(auth(admin))).status).toBe(204);
    const mine = await request(app).get('/api/time-entries').set(auth(admin));
    expect(mine.body.entries.some((e: { project: string }) => e.project === extra)).toBe(false);
  });

  it('lets administrators delete real users who own no projects', async () => {
    // Created directly: the auth rate limiter is close to its limit in this suite.
    const { User } = await import('../src/models/User');
    const { Project } = await import('../src/models/Project');
    const dan = await User.create({ name: 'Dan Demo', email: 'dan.demo@example.com', passwordHash: 'x' });
    expect((await request(app).delete(`/api/users/${dan._id}`).set(auth(bob))).status).toBe(403);
    expect((await request(app).delete(`/api/users/${adminId}`).set(auth(admin))).status).toBe(400); // admins are never deleted
    const own = await Project.create({ name: 'Dan owns this', key: 'DAN', startDate: '2026-11-02', finishDate: '2026-11-02', owner: dan._id });
    expect((await request(app).delete(`/api/users/${dan._id}`).set(auth(admin))).status).toBe(400); // still owns a project
    await own.deleteOne();
    expect((await request(app).delete(`/api/users/${dan._id}`).set(auth(admin))).status).toBe(204);
  });

  it('applies workflow rules to custom roles', async () => {
    const role = (await request(app).post('/api/roles').set(auth(admin)).send({ name: 'Site lead', permissions: ['edit_tasks'] })).body.role;
    const [neu, closed] = [ws.statuses.find((s) => s.name === 'New')!._id, ws.statuses.find((s) => s.name === 'Closed')!._id];
    const inProgress = ws.statuses.find((s) => s.name === 'In progress')!._id;
    const put = await request(app).put('/api/work-settings/workflow').set(auth(admin)).send({ [role._id]: { [inProgress]: [neu] } });
    expect(put.status).toBe(200);
    expect(put.body.workflow[role._id]).toEqual({ [inProgress]: [neu] });
    expect((await request(app).put('/api/work-settings/workflow').set(auth(admin)).send({ nonsense: {} })).status).toBe(400);

    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ userId: carolId, role: role._id });
    const blocked = await request(app).patch(`${tasksUrl()}/${taskId}`).set(auth(carol)).send({ status: closed });
    expect(blocked.status).toBe(400);
    const allowed = await request(app).patch(`${tasksUrl()}/${taskId}`).set(auth(carol)).send({ status: neu });
    expect(allowed.status).toBe(200);
  });
});
