import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {
  WindowLimiter,
  securityMiddleware,
  validateProductionConfig,
  validateAiInput,
  providerGuard,
} from '../serverSecurity';

test('rate limits reset after expiry and new keys cannot bypass a full limiter', () => {
  let now = 100;
  const limiter = new WindowLimiter(2, () => now);
  assert.equal(limiter.take('a', 2, 1000), true);
  assert.equal(limiter.take('a', 2, 1000), true);
  assert.equal(limiter.take('a', 2, 1000), false);
  assert.equal(limiter.take('b', 2, 1000), true);
  assert.equal(limiter.take('c', 2, 1000), false);
  now += 1001;
  assert.equal(limiter.take('c', 2, 1000), true);
});

test('production fails closed without HTTPS, single process, persistent safety storage and secrets', () => {
  assert.throws(() => validateProductionConfig({ NODE_ENV: 'production' }));
  const env = {
    NODE_ENV: 'production',
    APP_URL: 'https://coursemates.example',
    SINGLE_INSTANCE: 'true',
    DATA_DIR: './data',
    TRUST_PROXY_HOPS: '0',
    MODERATION_SECRET: 'a'.repeat(32),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'b'.repeat(32),
  };
  assert.doesNotThrow(() => validateProductionConfig(env));
  for (const patch of [
    { APP_URL: 'http://example.com' },
    { SINGLE_INSTANCE: 'false' },
    { WEB_CONCURRENCY: '2' },
    { ADMIN_USERNAME: '' },
    { ADMIN_PASSWORD: '' },
    { TRUST_PROXY_HOPS: '' },
    { TRUST_PROXY_HOPS: 'six' },
    { MODERATION_SECRET: '' },
  ]) {
    assert.throws(() => validateProductionConfig({ ...env, ...patch }));
  }
  assert.throws(
    () => validateProductionConfig({ ...env, ADMIN_PASSWORD: env.MODERATION_SECRET }),
    /different/i,
  );
  assert.doesNotThrow(() => validateProductionConfig({ ...env, ADMIN_TOKEN: 'c'.repeat(32) }));
  assert.throws(() => validateProductionConfig({ ...env, ADMIN_TOKEN: 'short' }), /ADMIN_TOKEN/i);
});

test('same-origin JSON writes work while cross-origin, missing-origin and form requests fail', async () => {
  const app = express();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  app.use(securityMiddleware({ origin: base, production: true }));
  app.use(express.json());
  app.post('/api/change', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.send('hello'));
  try {
    for (const origin of [undefined, 'https://evil.example', 'null']) {
      const response = await fetch(base + '/api/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: '{}',
      });
      assert.equal(response.status, 403);
    }
    const allowed = await fetch(base + '/api/change', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(allowed.status, 200);
    assert.equal(
      (await fetch(base + '/api/change', { method: 'POST', headers: { Origin: base }, body: '{}' }))
        .status,
      415,
    );
    const page = await fetch(base);
    assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(page.headers.get('strict-transport-security')!, /max-age=/);
    assert.match(page.headers.get('permissions-policy')!, /camera=\(self\)/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('AI input rejects oversized, malformed and nested conversation data', () => {
  for (const value of [
    null,
    [],
    { message: 'x'.repeat(4001) },
    { recentMessages: Array(21).fill({ text: 'hi' }) },
    { recentMessages: [{ text: { secret: 'hidden' } }] },
    { chatHistory: [null] },
    { action: 'arbitrary' },
  ]) {
    assert.throws(() => validateAiInput(value));
  }
  assert.doesNotThrow(() =>
    validateAiInput({ message: 'Hello', recentMessages: [{ text: 'Hi', isMe: true }] }),
  );
});

test('an HTTP flood is capped per client and every rejection advertises a retry window', async () => {
  const app = express();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  app.use(securityMiddleware({ origin: base, production: true, testRateScale: 0.05 }));
  app.use(express.json());
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  try {
    const results = await Promise.all(
      Array.from({ length: 200 }, () => fetch(base + '/api/health')),
    );
    const allowed = results.filter((response) => response.status === 200);
    const limited = results.filter((response) => response.status === 429);
    assert.equal(allowed.length + limited.length, results.length);
    assert.equal(allowed.length, 60);
    assert.equal(limited.length, 140);
    for (const response of limited) {
      assert.equal(response.headers.get('retry-after'), '60');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a provider outage caps concurrency, opens a circuit and recovers after the cooldown', async () => {
  const app = express();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;

  let clock = 1_000_000;
  const now = () => clock;
  let mode: 'hold' | 'fail' | 'ok' = 'fail';
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  app.get('/api/ai/outage', providerGuard(1, now), async (_req, res) => {
    if (mode === 'hold') await held;
    if (mode === 'fail') {
      res.status(500).json({ error: 'provider unavailable' });
      return;
    }
    res.json({ ok: true });
  });

  try {
    // A busy provider refuses the next caller instead of queueing work forever.
    mode = 'hold';
    const inFlight = fetch(base + '/api/ai/outage');
    await new Promise((resolve) => setTimeout(resolve, 25));
    const refused = await fetch(base + '/api/ai/outage');
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get('retry-after'), '30');
    release();
    assert.equal((await inFlight).status, 200);

    // Repeated provider failures open the circuit.
    mode = 'fail';
    for (let i = 0; i < 5; i++) {
      assert.equal((await fetch(base + '/api/ai/outage')).status, 500);
    }
    mode = 'ok';
    const open = await fetch(base + '/api/ai/outage');
    assert.equal(open.status, 503);
    assert.equal(open.headers.get('retry-after'), '30');

    // The cooldown is time-based, so traffic resumes once it elapses.
    clock += 30_001;
    assert.equal((await fetch(base + '/api/ai/outage')).status, 200);
  } finally {
    release();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
