import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
let runReminders: (today?: string) => Promise<{ notifications: number; emails: number }>;
let outbox: { to: string; subject: string; text: string }[];
const CRON_SECRET = 'cron-secret-cron-secret-1234';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri('pms-import');
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.CRON_SECRET = CRON_SECRET;
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app');
  ({ runReminders } = await import('../src/services/reminders'));
  outbox = (await import('../src/services/mailer')).outbox;
  app = createApp();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const xml = readFileSync(join(__dirname, 'fixtures', 'fit-out.xml'));
type Task = { _id: string; name: string; parent: string | null; start: string; finish: string; duration: number; isSummary: boolean; isMilestone: boolean; percentComplete: number; work: number | null; assignee: string | null; resources: string[]; predecessors: { task: string; type: string; lag: number }[]; notes: string };

describe('Import, reminders and calendar feeds', () => {
  let alice: string;
  let aliceId: string;
  let bob: string;
  let projectId: string;
  let tasks: Task[];
  const byName = (n: string) => tasks.find((t) => t.name === n)!;

  it('previews and imports an MS Project XML plan into a new project', async () => {
    const reg = async (name: string, email: string) => (await request(app).post('/api/auth/register').send({ name, email, password: 'password123' })).body;
    const a = await reg('Alice Admin', 'alice@example.com');
    const b = await reg('Bob Builder', 'bob@example.com');
    [alice, aliceId, bob] = [a.token, a.user._id, b.token];

    const preview = await request(app).post('/api/import/msproject/preview').set(auth(alice)).attach('file', xml, 'Fit-out.xml');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ name: 'Level 5 Fit-out', startDate: '2026-11-02' });
    expect(preview.body.rows.map((r: { name: string; level: number }) => `${r.level}:${r.name}`)).toEqual([
      '1:Design & approvals',
      '2:Site survey',
      '2:Detailed drawings',
      '2:Client approval',
      '1:Partitions, ceilings',
    ]);
    const drawings = preview.body.rows[2];
    expect(drawings).toMatchObject({ duration: 5, work: 60, percentComplete: 20, predecessors: [{ key: '2', type: 'FS', lag: 1 }] });

    const commit = await request(app)
      .post('/api/import/commit')
      .set(auth(alice))
      .send({ newProject: { name: preview.body.name, startDate: preview.body.startDate }, rows: preview.body.rows });
    expect(commit.status).toBe(201);
    expect(commit.body).toMatchObject({ createdProject: true, tasks: 5, summaries: 1, milestones: 1, links: 3, resourcesCreated: 2, assigned: 1 });
    projectId = commit.body.projectId;

    tasks = (await request(app).get(`/api/projects/${projectId}/tasks`).set(auth(alice))).body.tasks;
    const design = byName('Design & approvals');
    expect(design.isSummary).toBe(true);
    expect(byName('Site survey')).toMatchObject({ parent: design._id, start: '2026-11-02', finish: '2026-11-03', percentComplete: 100, assignee: aliceId, notes: 'Measure the floor plate, check services.' });
    expect(byName('Detailed drawings')).toMatchObject({ start: '2026-11-05', finish: '2026-11-11', work: 60 });
    expect(byName('Client approval').isMilestone).toBe(true);
    expect(byName('Partitions, ceilings')).toMatchObject({ parent: null, predecessors: [{ task: byName('Client approval')._id, type: 'SS', lag: 0 }] });
    expect(byName('Partitions, ceilings').resources).toHaveLength(1);
  });

  it('rejects XML entity declarations and non-plans', async () => {
    const bomb = Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Project><Tasks><Task><Name>&a;</Name></Task></Tasks></Project>');
    expect((await request(app).post('/api/import/msproject/preview').set(auth(alice)).attach('file', bomb, 'x.xml')).status).toBe(400);
    expect((await request(app).post('/api/import/msproject/preview').set(auth(alice)).attach('file', Buffer.from('not xml <'), 'x.xml')).status).toBe(400);
  });

  it('appends spreadsheet rows to an existing project and enforces access', async () => {
    const rows = [
      { key: '10', name: 'Handover', level: 1, duration: 0 },
      { key: '11', name: 'Snagging', level: 1, duration: 2, predecessors: [{ key: '12', type: 'FS', lag: 0 }], assignee: 'ALICE@example.com', resources: ['Cleaners'], work: 12 },
      { key: '12', name: 'Cleaning', level: 1, duration: 1, start: '2026-11-23', assignee: 'Nobody Known' },
    ];
    const res = await request(app).post('/api/import/commit').set(auth(alice)).send({ projectId, rows });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ createdProject: false, tasks: 3, links: 1, assigned: 1, resourcesCreated: 1 });
    expect(res.body.warnings.join(' ')).toContain('Nobody Known');
    tasks = (await request(app).get(`/api/projects/${projectId}/tasks`).set(auth(alice))).body.tasks;
    expect(byName('Cleaning').start).toBe('2026-11-23');
    expect(byName('Snagging').start > byName('Cleaning').finish).toBe(true);

    // Bob cannot see the project; a link cycle fails without creating a project.
    expect((await request(app).post('/api/import/commit').set(auth(bob)).send({ projectId, rows })).status).toBe(404);
    const before = (await request(app).get('/api/projects').set(auth(bob))).body.projects.length;
    const cycle = await request(app)
      .post('/api/import/commit')
      .set(auth(bob))
      .send({ newProject: { name: 'Cycle', startDate: '2026-11-02' }, rows: [{ key: 'a', name: 'A', predecessors: [{ key: 'b' }] }, { key: 'b', name: 'B', predecessors: [{ key: 'a' }] }] });
    expect(cycle.status).toBe(400);
    expect((await request(app).get('/api/projects').set(auth(bob))).body.projects.length).toBe(before);
  });

  it('sends each due-soon and overdue reminder once', async () => {
    const drawings = byName('Detailed drawings'); // 5 Nov – 11 Nov, 20 % done
    await request(app).patch(`/api/projects/${projectId}/tasks/${drawings._id}`).set(auth(alice)).send({ assignee: aliceId });
    const mine = async () => (await request(app).get('/api/notifications?limit=50').set(auth(alice))).body.notifications.filter((n: { task: string }) => n.task === drawings._id);

    expect((await runReminders('2026-11-10')).notifications).toBeGreaterThan(0);
    let list = await mine();
    expect(list.filter((n: { reason: string }) => n.reason === 'due_soon')).toHaveLength(1);
    expect(list[0]).toMatchObject({ summary: expect.stringContaining('Due tomorrow'), actor: null });

    await runReminders('2026-11-10');
    expect((await mine()).filter((n: { reason: string }) => n.reason === 'due_soon')).toHaveLength(1);

    await runReminders('2026-11-13');
    await runReminders('2026-11-14');
    list = await mine();
    expect(list.filter((n: { reason: string }) => n.reason === 'overdue')).toHaveLength(1);

    // Preferences: switch overdue alerts off, digest on (one email per day).
    const prefs = await request(app).put('/api/reminders/preferences').set(auth(alice)).send({ overdue: true, digest: true, dueSoonDays: 3 });
    expect(prefs.body.user.reminders).toMatchObject({ digest: true, dueSoonDays: 3, assigned: true });
    const sent = outbox.length;
    await runReminders('2026-11-16');
    await runReminders('2026-11-16');
    const digests = outbox.slice(sent).filter((m) => m.to === 'alice@example.com' && m.subject.startsWith('Task reminders'));
    expect(digests).toHaveLength(1);
    expect(digests[0].text).toContain('Detailed drawings');
  });

  it('protects the cron endpoint with the shared secret', async () => {
    expect((await request(app).post('/api/jobs/reminders')).status).toBe(401);
    expect((await request(app).post('/api/jobs/reminders').set('X-Cron-Secret', 'wrong-secret-wrong-secret!!')).status).toBe(401);
    const ok = await request(app).post('/api/jobs/reminders').set('X-Cron-Secret', CRON_SECRET);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('notifications');
    expect((await request(app).post('/api/reminders/run').set(auth(bob))).status).toBe(403);
  });

  it('serves valid calendar feeds behind a revocable secret token', async () => {
    expect((await request(app).get('/api/calendar-feed').set(auth(alice))).body.token).toBeNull();
    const { token } = (await request(app).post('/api/calendar-feed').set(auth(alice))).body;
    expect(token.length).toBeGreaterThan(20);

    const feed = await request(app).get(`/api/ical/${token}/my-tasks.ics`);
    expect(feed.status).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    const body: string = feed.text;
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(body.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75)).toBe(true);
    const unfolded = body.replace(/\r\n /g, '');
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20261105');
    expect(unfolded).toContain('DTEND;VALUE=DATE:20261112'); // exclusive end
    expect(unfolded).toMatch(/SUMMARY:\[L5FO-\d+\] Detailed drawings/);
    expect(unfolded).toMatch(/SUMMARY:✓ \[L5FO-\d+\] Site survey/); // done tasks are ticked
    expect(unfolded).toContain('Client approval'); // milestone of my project
    expect(unfolded).toContain('Snagging'); // assigned to Alice by email
    expect(unfolded).not.toContain('Cleaning'); // nobody assigned
    const project = await request(app).get(`/api/ical/${token}/project/${projectId}.ics`);
    expect(project.status).toBe(200);
    const projectFeed = project.text.replace(/\r\n /g, '');
    expect(projectFeed).toContain('Partitions\\, ceilings'); // commas are escaped
    expect(projectFeed).toContain('Cleaning');

    // Bob's token cannot read Alice's project; revoked tokens stop working.
    const bobToken = (await request(app).post('/api/calendar-feed').set(auth(bob))).body.token;
    expect((await request(app).get(`/api/ical/${bobToken}/project/${projectId}.ics`)).status).toBe(404);
    await request(app).delete('/api/calendar-feed').set(auth(alice));
    expect((await request(app).get(`/api/ical/${token}/my-tasks.ics`)).status).toBe(404);
  });
});
