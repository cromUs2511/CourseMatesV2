import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { attachRuntime, issueSession } from '../runtime';

const app = express();
app.use(express.json());
const server = http.createServer(app);
const stop = attachRuntime(app, server);
let base: string;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
after(async () => {
  stop();
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
type Session = ReturnType<typeof issueSession>;
const identity = () => issueSession('test@gmail.com', {}, false);
async function request(path: string, session?: Session, body?: unknown) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(session ? { Cookie: 'cm_session=' + session.token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function pair() {
  const a = identity(),
    b = identity();
  assert.equal(
    (await request('/api/match/join', a, { interests: ['Calculus'] })).data.status,
    'queued',
  );
  const result = await request('/api/match/join', b, { interests: ['Calculus'] });
  assert.equal(result.data.status, 'matched');
  return { a, b, roomId: result.data.roomId as string };
}
// Push the server clock past the 30 s silence window, let the 5 s cleanup
// sweep run in real time, then restore the clock.
async function advancePastSilenceWindow(t: any, ms = 45000) {
  const clock = Date.now() + ms;
  t.mock.method(Date, 'now', () => clock);
  await new Promise((resolve) => setTimeout(resolve, 6000));
  t.mock.restoreAll();
}

test('a quiet peer does not end the chat for the peer who stayed', async (t) => {
  const { a, b, roomId } = await pair();
  try {
    assert.equal((await request('/api/chat/send', a, { roomId, text: 'still here' })).status, 200);
    // B backgrounds mid-chat and goes fully quiet; A keeps polling.
    const clock = Date.now() + 45000;
    t.mock.method(Date, 'now', () => clock);
    for (let poll = 0; poll < 3; poll += 1) {
      const active = await request('/api/chat/messages?roomId=' + roomId, a);
      assert.equal(active.data.active, true);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    t.mock.restoreAll();
    // The room survived: history is intact for the peer who stayed…
    const stayed = await request('/api/chat/messages?roomId=' + roomId, a);
    assert.equal(stayed.data.active, true);
    assert.equal(stayed.data.peerDisconnected, false);
    assert.ok(stayed.data.messages.some((message: any) => message.text === 'still here'));
    // …and the returnee rejoins the same room with the same history.
    const returned = await request('/api/chat/messages?roomId=' + roomId, b);
    assert.equal(returned.data.active, true);
    assert.equal(returned.data.peerDisconnected, false);
    assert.ok(returned.data.messages.some((message: any) => message.text === 'still here'));
    // No duplicate history was created by the silence.
    assert.equal(returned.data.messages.length, stayed.data.messages.length);
  } finally {
    t.mock.restoreAll();
    await request('/api/chat/leave', a, { roomId });
  }
});

test('a room where everyone goes quiet is still cleaned up', async (t) => {
  const { a, b, roomId } = await pair();
  try {
    assert.equal(
      (await request('/api/chat/send', a, { roomId, text: 'goodbye soon' })).status,
      200,
    );
    await advancePastSilenceWindow(t);
    const poll = await request('/api/chat/messages?roomId=' + roomId, a);
    assert.equal(poll.data.active, false);
    assert.equal(poll.data.peerDisconnected, true);
    const peerPoll = await request('/api/chat/messages?roomId=' + roomId, b);
    assert.equal(peerPoll.data.active, false);
  } finally {
    t.mock.restoreAll();
  }
});

test('a peer who explicitly leaves still ends the chat for the returnee', async () => {
  const { a, b, roomId } = await pair();
  try {
    assert.equal((await request('/api/chat/send', a, { roomId, text: 'before' })).status, 200);
    assert.equal((await request('/api/chat/leave', b, { roomId })).status, 200);
    const poll = await request('/api/chat/messages?roomId=' + roomId, a);
    assert.equal(poll.data.active, false);
    assert.equal(poll.data.peerDisconnected, true);
  } finally {
    await request('/api/chat/leave', a, { roomId });
  }
});

test('an expired session cannot rejoin its old room', async (t) => {
  const { a, roomId } = await pair();
  try {
    assert.equal(
      (await request('/api/chat/send', a, { roomId, text: 'before expiry' })).status,
      200,
    );
    await advancePastSilenceWindow(t, 9 * 60 * 60 * 1000);
    assert.equal((await request('/api/chat/messages?roomId=' + roomId, a)).status, 401);
  } finally {
    t.mock.restoreAll();
  }
});
