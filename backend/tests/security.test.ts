import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { authenticator } from 'otplib';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';

let mongo: MongoMemoryServer;
let app: Express;

// ---- Mock OpenID Connect provider ---------------------------------------------------------------
let oidc: Server;
let issuer = '';
let privateKey: KeyLike;
let jwk: Record<string, unknown>;
const pendingLogins = new Map<string, { nonce: string; email: string; sub: string; verifier?: string }>();
let nextIdentity = { email: 'sso.user@example.com', sub: 'sub-1', verified: true };

// ---- Webhook receiver ---------------------------------------------------------------------------
let receiver: Server;
let receiverUrl = '';
const received: { headers: IncomingMessage['headers']; body: string }[] = [];
let receiverStatus = 200;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  oidc = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
    }
    if (url.pathname === '/jwks') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const login = pendingLogins.get(form.get('code') ?? '');
      if (!login || form.get('client_secret') !== 'test-secret' || !form.get('code_verifier')) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      const idToken = await new SignJWT({ nonce: login.nonce, email: login.email, email_verified: nextIdentity.verified, name: 'Sam Single' })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience('pms-test')
        .setSubject(login.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ access_token: 'x', token_type: 'Bearer', id_token: idToken }));
    }
    res.statusCode = 404;
    res.end();
  });
  issuer = `http://127.0.0.1:${await listen(oidc)}`;

  receiver = createServer(async (req, res) => {
    received.push({ headers: req.headers, body: await readBody(req) });
    res.statusCode = receiverStatus;
    res.end('thanks');
  });
  receiverUrl = `http://127.0.0.1:${await listen(receiver)}/hook`;

  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  Object.assign(process.env, {
    MONGODB_URI: mongo.getUri('pms-security'),
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    FRONTEND_URL: 'http://localhost:3000',
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'pms-test',
    OIDC_CLIENT_SECRET: 'test-secret',
    OIDC_DISPLAY_NAME: 'Nexora',
    OIDC_AUTO_CREATE_USERS: 'true',
    OIDC_ALLOWED_DOMAINS: 'example.com',
  });
  await mongoose.connect(process.env.MONGODB_URI!);
  const { createApp } = await import('../src/app');
  const { webhookConfig } = await import('../src/services/webhooks');
  webhookConfig.backoffMs = 10;
  app = createApp();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  oidc?.close();
  receiver?.close();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const waitFor = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return check();
};

describe('Security & integrations', () => {
  let admin = '';
  let adminId = '';

  it('sets up an administrator', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Ada Admin', email: 'ada@example.com', password: 'password123' });
    [admin, adminId] = [res.body.token, res.body.user._id];
    expect(res.body.user.twoFactorEnabled).toBe(false);
  });

  it('enrols in two-factor authentication and signs in with a code or backup code', async () => {
    const setup = await request(app).post('/api/auth/2fa/setup').set(auth(admin));
    expect(setup.status).toBe(200);
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    const secret: string = setup.body.secret;

    expect((await request(app).post('/api/auth/2fa/enable').set(auth(admin)).send({ code: '000000' })).status).toBe(400);
    const enable = await request(app).post('/api/auth/2fa/enable').set(auth(admin)).send({ code: authenticator.generate(secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.backupCodes).toHaveLength(10);
    const backup: string = enable.body.backupCodes[0];

    // Password alone now yields a challenge, not a session — and the challenge is not a session token.
    const login = await request(app).post('/api/auth/login').send({ email: 'ada@example.com', password: 'password123' });
    expect(login.body).toMatchObject({ twoFactorRequired: true });
    expect(login.body.token).toBeUndefined();
    expect((await request(app).get('/api/auth/me').set(auth(login.body.challenge))).status).toBe(401);

    // The code used for enrolment cannot be replayed.
    const replay = await request(app).post('/api/auth/2fa/verify').send({ challenge: login.body.challenge, code: authenticator.generate(secret) });
    expect(replay.status).toBe(401);

    const viaBackup = await request(app).post('/api/auth/2fa/verify').send({ challenge: login.body.challenge, code: backup });
    expect(viaBackup.status).toBe(200);
    expect(viaBackup.body.backupCodesLeft).toBe(9);
    expect((await request(app).post('/api/auth/2fa/verify').send({ challenge: login.body.challenge, code: backup })).status).toBe(401); // single use

    // A code from the next time step works once.
    const next = authenticator.clone({ epoch: Date.now() + 30_000 }).generate(secret);
    const viaCode = await request(app).post('/api/auth/2fa/verify').send({ challenge: login.body.challenge, code: next });
    expect(viaCode.status).toBe(200);
    admin = viaCode.body.token;
    expect((await request(app).get('/api/auth/2fa').set(auth(admin))).body).toMatchObject({ enabled: true, backupCodesLeft: 9 });
  });

  it('issues API tokens with read/write scopes', async () => {
    const created = await request(app).post('/api/tokens').set(auth(admin)).send({ name: 'Reporting', scope: 'read', expiresInDays: 30 });
    expect(created.status).toBe(201);
    const readToken: string = created.body.token;
    expect(readToken).toMatch(/^pms_/);
    expect(JSON.stringify(created.body.apiToken)).not.toContain('tokenHash');

    expect((await request(app).get('/api/projects').set(auth(readToken))).status).toBe(200);
    expect((await request(app).post('/api/projects').set(auth(readToken)).send({ name: 'Nope', startDate: '2026-11-02' })).status).toBe(403);
    expect((await request(app).get('/api/tokens').set(auth(readToken))).status).toBe(403); // tokens can't manage tokens
    expect((await request(app).post('/api/auth/2fa/setup').set(auth(readToken))).status).toBe(403);

    const write = (await request(app).post('/api/tokens').set(auth(admin)).send({ name: 'Sync', scope: 'write' })).body;
    expect((await request(app).post('/api/projects').set(auth(write.token)).send({ name: 'Via token', startDate: '2026-11-02' })).status).toBe(201);

    const list = await request(app).get('/api/tokens').set(auth(admin));
    expect(list.body.tokens).toHaveLength(2);
    expect(list.body.tokens[0].lastUsedAt).toBeTruthy();
    expect((await request(app).delete(`/api/tokens/${created.body.apiToken._id}`).set(auth(admin))).status).toBe(204);
    expect((await request(app).get('/api/projects').set(auth(readToken))).status).toBe(401);
    expect((await request(app).get('/api/projects').set(auth('pms_not-a-real-token'))).status).toBe(401);
  });

  it('delivers signed webhooks, tests, redelivers and retries', async () => {
    expect((await request(app).post('/api/webhooks').set(auth(admin)).send({ name: 'Bad', url: 'http://example.com/hook' })).status).toBe(400); // https only
    const created = await request(app).post('/api/webhooks').set(auth(admin)).send({ name: 'Receiver', url: receiverUrl, events: ['project.*'] });
    expect(created.status).toBe(201);
    const { secret } = created.body;
    const hookId = created.body.webhook._id;
    expect(created.body.webhook.secret).toBeUndefined();

    const project = await request(app).post('/api/projects').set(auth(admin)).send({ name: 'Hooked', startDate: '2026-11-02' });
    expect(await waitFor(() => received.some((r) => r.headers['x-pms-event'] === 'project.created'))).toBe(true);
    const hit = received.find((r) => r.headers['x-pms-event'] === 'project.created')!;
    expect(hit.headers['x-pms-signature']).toBe(`sha256=${createHmac('sha256', secret).update(hit.body).digest('hex')}`);
    const payload = JSON.parse(hit.body);
    expect(payload).toMatchObject({ type: 'project.created', projectId: project.body.project._id, actor: { name: 'Ada Admin' }, data: { name: 'Hooked' } });
    expect(payload.body).toBeUndefined(); // request bodies are never forwarded

    // Task events are filtered out by this webhook.
    received.length = 0;
    await request(app).post(`/api/projects/${project.body.project._id}/tasks`).set(auth(admin)).send({ name: 'Ignored' });
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(0);

    const test = await request(app).post(`/api/webhooks/${hookId}/test`).set(auth(admin));
    expect(test.body.delivery).toMatchObject({ ok: true, status: 200, eventType: 'ping' });

    receiverStatus = 500;
    const failing = await request(app).post(`/api/webhooks/${hookId}/test`).set(auth(admin));
    expect(failing.body.delivery).toMatchObject({ ok: false, status: 500, attempts: 4 });
    receiverStatus = 200;
    const redo = await request(app).post(`/api/webhooks/${hookId}/deliveries/${failing.body.delivery._id}/redeliver`).set(auth(admin));
    expect(redo.body.delivery).toMatchObject({ ok: true, eventType: 'ping' });

    const deliveries = await request(app).get(`/api/webhooks/${hookId}/deliveries`).set(auth(admin));
    expect(deliveries.body.deliveries.length).toBeGreaterThanOrEqual(3);
    const hooks = await request(app).get('/api/webhooks').set(auth(admin));
    expect(hooks.body.webhooks[0].consecutiveFailures).toBe(0);
  });

  it('signs in with OpenID Connect and creates or links accounts', async () => {
    expect((await request(app).get('/api/auth/sso/config')).body).toEqual({ enabled: true, label: 'Nexora' });

    const signIn = async (email: string, sub: string) => {
      const start = await request(app).get('/api/auth/sso/start');
      expect(start.status).toBe(302);
      const location = new URL(start.headers.location);
      expect(location.origin).toBe(issuer);
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      const code = `code-${sub}`;
      pendingLogins.set(code, { nonce: location.searchParams.get('nonce')!, email, sub });
      return request(app).get(`/api/auth/sso/callback?code=${code}&state=${location.searchParams.get('state')}`);
    };

    const created = await signIn('sam@example.com', 'sub-sam');
    expect(created.status).toBe(302);
    const target = new URL(created.headers.location);
    expect(target.pathname).toBe('/sso/callback');
    expect(target.search).toBe(''); // never in the query string
    const token = new URLSearchParams(target.hash.slice(1)).get('token')!;
    const me = await request(app).get('/api/auth/me').set(auth(token));
    expect(me.body.user).toMatchObject({ email: 'sam@example.com', name: 'Sam Single', sso: true, emailVerified: true });

    // Existing password user (with 2FA) is linked by verified email and skips the app's TOTP.
    const linked = await signIn('ada@example.com', 'sub-ada');
    const adaToken = new URLSearchParams(new URL(linked.headers.location).hash.slice(1)).get('token')!;
    expect((await request(app).get('/api/auth/me').set(auth(adaToken))).body.user._id).toBe(adminId);

    // Replayed state, other domains and unknown states are refused.
    const outsider = await signIn('eve@evil.test', 'sub-eve');
    expect(outsider.headers.location).toContain('sso_error=');
    const bogus = await request(app).get('/api/auth/sso/callback?code=x&state=unknown');
    expect(bogus.headers.location).toContain('sso_error=');
  });

  it('serves a valid OpenAPI 3.1 document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/projects', '/projects/{id}/tasks', '/time-entries', '/webhooks']));
    expect(JSON.stringify(res.body)).not.toContain('"nullable"');
    // Every $ref resolves.
    const refs = [...JSON.stringify(res.body).matchAll(/"\$ref":"#\/components\/(\w+)\/(\w+)"/g)];
    for (const [, section, name] of refs) expect(res.body.components[section][name], `${section}/${name}`).toBeTruthy();
  });

  it('lets an administrator require 2FA and reset it for a user', async () => {
    const res = await request(app).put('/api/settings').set(auth(admin)).send({ require2fa: true });
    expect(res.body.require2fa).toBe(true);
    const reset = await request(app).post(`/api/auth/2fa/reset/${adminId}`).set(auth(admin));
    expect(reset.body.user.twoFactorEnabled).toBe(false);
  });
});
