import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { attachRuntime, issueSession, runtimeStats } from '../runtime';
import { securityMiddleware } from '../serverSecurity';

const ADMIN_TOKEN = 'load-test-admin-token-0123456789abcdef';
const limits = { sessions: 10, queued: 2, rooms: 2, sockets: 10, mediaBytes: 1024 * 1024 };

const app = express();
app.use(securityMiddleware({ production: false, adminToken: ADMIN_TOKEN, testRateScale: 100 }));
app.use(express.json({ limit: '64kb' }));
const server = http.createServer(app);
const stopRuntime = attachRuntime(app, server, { adminToken: ADMIN_TOKEN, limits });
let base: string;
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  stopRuntime();
};

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
after(async () => {
  stop();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const session = (name: string) => issueSession(`${name}@gmail.com`);
async function call(path: string, from?: { token: string }, body?: unknown) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(from ? { Cookie: 'cm_session=' + from.token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: (await response.json()) as any };
}

test('session, queue and room caps reject load without leaking state', async () => {
  const peers = Array.from({ length: limits.sessions }, (_, index) => session('load' + index));
  assert.throws(() => session('overflow'), /capacity/i);

  assert.equal(
    (await call('/api/match/join', peers[0]!, { interests: ['Calculus'] })).data.status,
    'queued',
  );
  assert.equal(
    (await call('/api/match/join', peers[1]!, { interests: ['Calculus'] })).data.status,
    'matched',
  );
  assert.equal(
    (await call('/api/match/join', peers[2]!, { interests: ['Physics'] })).data.status,
    'queued',
  );
  assert.equal(
    (await call('/api/match/join', peers[3]!, { interests: ['Physics'] })).data.status,
    'matched',
  );

  assert.equal(
    (await call('/api/match/join', peers[4]!, { interests: ['Algebra'] })).data.status,
    'queued',
  );
  const roomCap = await call('/api/match/join', peers[5]!, { interests: ['Algebra'] });
  assert.equal(roomCap.status, 400);
  assert.match(roomCap.data.error, /capacity/i);
  assert.equal(
    (await call('/api/match/join', peers[6]!, { interests: ['Biology'] })).data.status,
    'queued',
  );

  const queueCap = await call('/api/match/join', peers[7]!, { interests: ['Chemistry'] });
  assert.equal(queueCap.status, 400);
  assert.match(queueCap.data.error, /queue is full/i);

  const stats = runtimeStats();
  assert.equal(stats.rooms, limits.rooms);
  assert.equal(stats.queued, limits.queued);
  assert.equal(stats.sessions, limits.sessions);
  assert.equal(stats.mediaBytes, 0);
});

test('administrative metrics need a token and never expose conversation content', async () => {
  const attempts: Array<Record<string, string>> = [
    {},
    { Authorization: 'Bearer wrong-token-value-0123456789' },
  ];
  for (const headers of attempts) {
    const response = await fetch(base + '/api/admin/metrics', { headers });
    assert.equal(response.status, 401);
  }
  const allowed = await fetch(base + '/api/admin/metrics', {
    headers: { Authorization: 'Bearer ' + ADMIN_TOKEN },
  });
  assert.equal(allowed.status, 200);
  const payload = (await allowed.json()) as Record<string, unknown>;
  for (const key of [
    'sessions',
    'queued',
    'rooms',
    'sockets',
    'mediaBytes',
    'requests',
    'memory',
  ]) {
    assert.ok(key in payload, `metrics should report ${key}`);
  }
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['messages', 'token', 'email', 'actor', 'ip']) {
    assert.ok(!serialized.includes(forbidden), `metrics must not report ${forbidden}`);
  }
});

test('shutdown drains every room, queue entry and session and flips readiness', async () => {
  assert.ok(runtimeStats().rooms > 0);
  stop();
  const stats = runtimeStats();
  assert.equal(stats.rooms, 0);
  assert.equal(stats.queued, 0);
  assert.equal(stats.sessions, 0);
  assert.equal(stats.sockets, 0);
  assert.equal(stats.mediaBytes, 0);

  const ready = await fetch(base + '/api/health/ready');
  assert.equal(ready.status, 503);
  assert.equal(((await ready.json()) as { status: string }).status, 'draining');
  assert.equal((await fetch(base + '/api/health')).status, 200);

  const revived = await call('/api/match/join', { token: 'gone' }, { interests: ['Calculus'] });
  assert.equal(revived.status, 401);
  const restored = await fetch(base + '/api/auth/session');
  assert.equal(((await restored.json()) as { session: unknown }).session, null);
});
