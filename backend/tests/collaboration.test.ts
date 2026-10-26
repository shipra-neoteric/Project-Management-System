import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
let outbox: { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] }[];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri('pms-collaboration');
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
const EVIL = '<p>Hi <strong>team</strong><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">bad</a> <a href="https://example.com">good</a></p>';
const isClean = (html: string) => !/<script|onerror|javascript:|<img/i.test(html);

describe('Meetings and rich text', () => {
  let admin: string;
  let bob: string;
  let bobId: string;
  let carol: string;
  let carolId: string;
  let projectId: string;
  let taskId: string;
  let meetingId: string;
  const base = () => `/api/projects/${projectId}/meetings`;

  it('sets up a project with a member and a viewer', async () => {
    const reg = async (name: string, email: string) => (await request(app).post('/api/auth/register').send({ name, email, password: 'password123' })).body;
    const a = await reg('Alice Admin', 'alice@example.com');
    const b = await reg('Bob Builder', 'bob@example.com');
    const c = await reg('Carol Client', 'carol@example.com');
    [admin, bob, bobId, carol, carolId] = [a.token, b.token, b.user._id, c.token, c.user._id];
    projectId = (await request(app).post('/api/projects').set(auth(admin)).send({ name: 'Fit-out', startDate: '2026-11-02' })).body.project._id;
    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ userId: bobId, role: 'member' });
    await request(app).post(`/api/projects/${projectId}/members`).set(auth(admin)).send({ userId: carolId, role: 'viewer' });
    taskId = (await request(app).post(`/api/projects/${projectId}/tasks`).set(auth(admin)).send({ name: 'Ceilings', duration: 5 })).body.createdTaskId;
  });

  it('lets members schedule meetings, viewers only read them', async () => {
    const body = {
      title: 'Weekly site meeting',
      location: 'Site office',
      startsAt: '2026-11-03T04:30:00.000Z',
      durationMinutes: 45,
      participants: [bobId, carolId],
      agenda: [{ title: 'Progress', durationMinutes: 15, notes: EVIL, task: taskId }, { title: 'Safety', durationMinutes: 10, presenter: bobId }],
    };
    expect((await request(app).post(base()).set(auth(carol)).send(body)).status).toBe(403);
    const created = await request(app).post(base()).set(auth(bob)).send(body);
    expect(created.status).toBe(201);
    meetingId = created.body.meeting._id;
    const m = created.body.meeting;
    expect(m.participants).toHaveLength(2); // the organiser (Bob) is listed once
    expect(m.agenda[0].task).toMatchObject({ _id: taskId, name: 'Ceilings' });
    expect(isClean(m.agenda[0].notes)).toBe(true);
    expect(m.agenda[0].notes).toContain('<strong>team</strong>');
    expect(m.agenda[0].notes).toContain('rel="noopener noreferrer nofollow"');

    const list = await request(app).get(`${base()}?scope=all`).set(auth(carol));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ canManage: false });
    expect(list.body.meetings[0]).toMatchObject({ agendaCount: 2, agendaMinutes: 25 });
    // Outsiders cannot be invited
    const outsider = await request(app).post('/api/auth/register').send({ name: 'Olly', email: 'olly@example.com', password: 'password123' });
    expect((await request(app).patch(`${base()}/${meetingId}`).set(auth(bob)).send({ participants: [outsider.body.user._id] })).status).toBe(400);
  });

  it('creates and edits a recurring series', async () => {
    const res = await request(app)
      .post(base())
      .set(auth(admin))
      .send({ title: 'Client review', startsAt: '2026-11-02T09:00:00.000Z', recurrence: { frequency: 'weekly', until: '2026-11-23' } });
    expect(res.body.created).toBe(4);
    const series = (await request(app).get(`${base()}/${res.body.meeting._id}`).set(auth(admin))).body.series;
    expect(series.map((s: { startsAt: string }) => s.startsAt.slice(0, 10))).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);

    // Change the second one and everything after it: new title and one hour later
    const upd = await request(app).patch(`${base()}/${series[1]._id}?scope=future`).set(auth(admin)).send({ title: 'Client review (new time)', startsAt: '2026-11-09T10:00:00.000Z' });
    expect(upd.body.updated).toBe(3);
    const after = (await request(app).get(`${base()}?scope=all`).set(auth(admin))).body.meetings.filter((m: { seriesId: string }) => m.seriesId === res.body.meeting.seriesId);
    expect(after.map((m: { title: string; startsAt: string }) => `${m.title}@${m.startsAt.slice(11, 16)}`)).toEqual([
      'Client review@09:00',
      'Client review (new time)@10:00',
      'Client review (new time)@10:00',
      'Client review (new time)@10:00',
    ]);
    const del = await request(app).delete(`${base()}/${series[2]._id}?scope=future`).set(auth(admin));
    expect(del.body.deleted).toBe(2);

    const monthly = await request(app).post(base()).set(auth(admin)).send({ title: 'Board update', startsAt: '2026-01-31T09:00:00.000Z', recurrence: { frequency: 'monthly', until: '2026-04-30' } });
    const months = (await request(app).get(`${base()}/${monthly.body.meeting._id}`).set(auth(admin))).body.series.map((s: { startsAt: string }) => s.startsAt.slice(0, 10));
    expect(months).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('turns agenda items into tasks (action items)', async () => {
    const m = (await request(app).get(`${base()}/${meetingId}`).set(auth(bob))).body.meeting;
    const itemId = m.agenda[1]._id;
    const res = await request(app).post(`${base()}/${meetingId}/agenda/${itemId}/actions`).set(auth(bob)).send({ title: 'Fix railing on level 2', assignee: bobId, dueDate: '2026-11-06' });
    expect(res.status).toBe(201);
    expect(res.body.meeting.agenda[1].actions[0]).toMatchObject({ name: 'Fix railing on level 2', assignee: bobId });
    const plan = await request(app).get(`/api/projects/${projectId}/tasks`).set(auth(bob));
    const task = plan.body.tasks.find((t: { _id: string }) => t._id === res.body.taskId);
    expect(task).toMatchObject({ start: '2026-11-03', finish: '2026-11-06', assignee: bobId });
    expect((await request(app).post(`${base()}/${meetingId}/agenda/${itemId}/actions`).set(auth(carol)).send({ title: 'x' })).status).toBe(403);
  });

  it('records attendance', async () => {
    expect((await request(app).post(`${base()}/${meetingId}/attendance`).set(auth(carol)).send({ attended: true })).status).toBe(200);
    expect((await request(app).post(`${base()}/${meetingId}/attendance`).set(auth(carol)).send({ userId: bobId, attended: false })).status).toBe(403);
    const res = await request(app).post(`${base()}/${meetingId}/attendance`).set(auth(bob)).send({ userId: bobId, attended: true });
    expect(res.body.meeting.participants.filter((p: { attended: boolean | null }) => p.attended === true)).toHaveLength(2);
  });

  it('sends invitations with a calendar file and notifies participants', async () => {
    outbox.length = 0;
    const res = await request(app).post(`${base()}/${meetingId}/invite`).set(auth(bob));
    expect(res.body.emailed).toBe(2);
    expect(res.body.meeting.status).toBe('open');
    const mail = outbox.find((m) => m.to === 'carol@example.com')!;
    expect(mail.subject).toContain('Weekly site meeting');
    const ics = mail.attachments![0].content;
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('DTSTART:20261103T043000Z');
    expect(ics).toContain('DTEND:20261103T051500Z');
    expect(ics).toContain('LOCATION:Site office');
    const notes = await request(app).get('/api/notifications').set(auth(carol));
    expect(notes.body.notifications[0]).toMatchObject({ reason: 'meeting', link: `/projects/${projectId}/meetings?meeting=${meetingId}` });

    const download = await request(app).get(`${base()}/${meetingId}/ics`).set(auth(carol));
    expect(download.headers['content-type']).toContain('text/calendar');
    expect(download.text).toContain('METHOD:PUBLISH');
  });

  it('keeps the agenda and people when only the minutes change', async () => {
    const before = (await request(app).get(`${base()}/${meetingId}`).set(auth(bob))).body.meeting;
    const after = (await request(app).patch(`${base()}/${meetingId}`).set(auth(bob)).send({ minutes: '<p>Draft notes</p>' })).body.meeting;
    expect(after.minutes).toContain('Draft notes');
    expect(after.agenda).toHaveLength(before.agenda.length);
    expect(after.participants).toHaveLength(before.participants.length);
    expect(after).toMatchObject({ location: before.location, durationMinutes: before.durationMinutes });
  });

  it('closes a meeting, emails the minutes and locks it', async () => {
    outbox.length = 0;
    const res = await request(app).post(`${base()}/${meetingId}/close`).set(auth(bob)).send({ minutes: `<p>Agreed to <em>start ceilings</em> Monday.</p>${EVIL}` });
    expect(res.body.meeting.status).toBe('closed');
    expect(isClean(res.body.meeting.minutes)).toBe(true);
    expect(outbox.filter((m) => m.subject.startsWith('Minutes:'))).toHaveLength(2);
    expect(outbox[0].text).toContain('Agreed to start ceilings Monday.');
    expect(outbox[0].html).toContain('<em>start ceilings</em>');
    expect((await request(app).patch(`${base()}/${meetingId}`).set(auth(bob)).send({ minutes: 'changed' })).status).toBe(400);
    expect((await request(app).post(`${base()}/${meetingId}/attendance`).set(auth(carol)).send({ attended: false })).status).toBe(400);
    expect((await request(app).post(`${base()}/${meetingId}/reopen`).set(auth(bob))).body.meeting.status).toBe('open');
  });

  it('sanitises rich text in task notes and project descriptions, keeps plain text', async () => {
    const plan = await request(app).patch(`/api/projects/${projectId}/tasks/${taskId}`).set(auth(admin)).send({ notes: EVIL });
    const task = plan.body.tasks.find((t: { _id: string }) => t._id === taskId);
    expect(isClean(task.notes)).toBe(true);
    expect(task.notes).toContain('href="https://example.com"');

    const plain = await request(app).patch(`/api/projects/${projectId}/tasks/${taskId}`).set(auth(admin)).send({ notes: 'Line 1\nLine 2 <3' });
    expect(plain.body.tasks.find((t: { _id: string }) => t._id === taskId).notes).toBe('Line 1\nLine 2 <3');

    const project = await request(app).patch(`/api/projects/${projectId}`).set(auth(admin)).send({ description: EVIL });
    expect(isClean(project.body.project.description)).toBe(true);
    const cleared = await request(app).patch(`/api/projects/${projectId}`).set(auth(admin)).send({ description: '<p></p>' });
    expect(cleared.body.project.description).toBe('');
  });

  it('grants the new meetings permission once to existing built-in roles', async () => {
    const { Role } = await import('../src/models/Access');
    const roles = (await request(app).get('/api/roles').set(auth(admin))).body.roles as { key: string; permissions: string[] }[];
    expect(roles.find((r) => r.key === 'member')!.permissions).toContain('manage_meetings');
    expect(roles.find((r) => r.key === 'viewer')!.permissions).not.toContain('manage_meetings');
    const { upgradeBuiltinRoles } = await import('../src/services/permissions');
    const memberPerms = async () => (await Role.findOne({ key: 'member' }).lean())!.permissions;

    // A database from before meetings: role without the permission and no seed record → granted once.
    await Role.updateOne({ key: 'member' }, { $pull: { permissions: 'manage_meetings' }, $unset: { seededPermissions: 1 } });
    await upgradeBuiltinRoles();
    expect(await memberPerms()).toContain('manage_meetings');

    // An admin removes it again → it stays removed on later upgrades.
    await Role.updateOne({ key: 'member' }, { $pull: { permissions: 'manage_meetings' } });
    await upgradeBuiltinRoles();
    expect(await memberPerms()).not.toContain('manage_meetings');
  });
});
