import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import type { AppEvent } from '../src/services/events';

let mongo: MongoMemoryServer;
let app: Express;
let events: AppEvent[] = [];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri('pms-events');
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app');
  const { subscribe } = await import('../src/services/events');
  subscribe((e) => void events.push(e));
  app = createApp();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('change events', () => {
  it('publishes typed events for successful changes only', async () => {
    const { token, user } = (await request(app).post('/api/auth/register').send({ name: 'Eve', email: 'eve@example.com', password: 'password123' })).body;
    const auth = { Authorization: `Bearer ${token}` };
    await settle();
    expect(events).toHaveLength(0); // registration is never announced

    const p = await request(app).post('/api/projects').set(auth).send({ name: 'Events', startDate: '2026-11-02' });
    const projectId = p.body.project._id;
    await settle();
    expect(events.at(-1)).toMatchObject({ type: 'project.created', action: 'created', projectId, entityId: projectId, actor: { id: user._id, name: 'Eve' } });

    events = [];
    const t = await request(app).post(`/api/projects/${projectId}/tasks`).set(auth).send({ name: 'Walls', duration: 3 });
    await request(app).patch(`/api/auth/me`).set(auth).send({ name: 'Eve A' });
    await request(app).patch(`/api/projects/${projectId}/tasks/000000000000000000000000`).set(auth).send({ name: 'x' }); // 404: no event
    await settle();
    expect(events.map((e) => e.type)).toEqual(['task.created', 'me.updated']);
    expect(events[0]).toMatchObject({ projectId, entityId: t.body.createdTaskId, resource: 'projects/tasks' });

    await request(app).post('/api/auth/change-password').set(auth).send({ currentPassword: 'password123', newPassword: 'password456' });
    await settle();
    const pw = events.find((e) => e.resource === 'auth/change-password');
    expect(JSON.stringify(pw?.body)).not.toContain('password456');
  });
});
