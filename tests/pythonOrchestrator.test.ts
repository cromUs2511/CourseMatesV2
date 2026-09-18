import test from 'node:test';
import assert from 'node:assert/strict';
import { createPythonOrchestratorClient } from '../pythonOrchestrator';

test('off mode never invokes the Python orchestrator', async () => {
  let calls = 0;
  const client = createPythonOrchestratorClient(
    { mode: 'off', baseUrl: 'http://127.0.0.1:5051', timeoutMs: 20 },
    async () => {
      calls += 1;
      throw new Error('must not be called');
    },
  );

  await client.observeIcebreakers({ topic: 'Calculus', discipline: 'Engineering', campus: 'Main Campus' });
  assert.equal(calls, 0);
});

test('shadow mode swallows an unavailable Python orchestrator', async () => {
  const client = createPythonOrchestratorClient(
    { mode: 'shadow', baseUrl: 'http://127.0.0.1:5051', timeoutMs: 20 },
    async () => { throw new Error('connection refused'); },
  );

  await assert.doesNotReject(() => client.observeIcebreakers({ topic: 'Calculus', discipline: 'Engineering', campus: 'Main Campus' }));
});

test('shadow mode sends the versioned internal icebreaker contract', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createPythonOrchestratorClient(
    { mode: 'shadow', baseUrl: 'http://python.internal/', timeoutMs: 20 },
    async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ contractVersion: 1, icebreakers: ['a', 'b', 'c', 'd'] }), { status: 200 });
    },
  );

  await client.observeIcebreakers({ topic: 'Calculus', discipline: 'Engineering', campus: 'Main Campus' });
  assert.equal(request?.url, 'http://python.internal/internal/v1/icebreakers');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    contractVersion: 1,
    topic: 'Calculus',
    discipline: 'Engineering',
    campus: 'Main Campus',
  });
});

test('shadow mode sends only anonymous match inputs to the Python selector', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createPythonOrchestratorClient(
    { mode: 'shadow', baseUrl: 'http://python.internal', timeoutMs: 20 },
    async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ contractVersion: 1, selection: null }), { status: 200 });
    },
  );

  await client.observeMatch({
    candidate: { id: 'student-a', verified: true, interests: ['Calculus'], allowNormal: false },
    queued: [{ id: 'student-b', verified: true, interests: ['Calculus'], allowNormal: true }],
  });
  assert.equal(request?.url, 'http://python.internal/internal/v1/match/select');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    contractVersion: 1,
    candidate: { id: 'student-a', verified: true, interests: ['Calculus'], allowNormal: false },
    queued: [{ id: 'student-b', verified: true, interests: ['Calculus'], allowNormal: true }],
  });
});
