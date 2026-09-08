import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachRuntime, issueSession, isSchoolEmail } from '../runtime';

const app = express();
app.use(express.json());
const server = http.createServer(app);
const stop = attachRuntime(app, server);
let base: string;
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
after(async () => {
  stop();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
const identity = (verified = false) => issueSession('test@mymail.mapua.edu.ph', {}, verified);
async function request(path: string, session?: ReturnType<typeof identity>, body?: unknown) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function pair() {
  const a = identity(), b = identity();
  assert.equal((await request('/api/match/join', a, { interests: ['Calculus'] })).data.status, 'queued');
  const result = await request('/api/match/join', b, { interests: ['Calculus'] });
  assert.equal(result.data.status, 'matched');
  return { a, b, roomId: result.data.roomId };
}
test('school address validation rejects suffix tricks, empty names, and invalid types', () => {
  for (const email of ['a@mymail.mapua.edu.ph', 'a@mymapua.edu.ph', 'a@mapua.edu.ph']) assert.equal(isSchoolEmail(email), true);
  for (const email of ['@mapua.edu.ph', 'a@@mapua.edu.ph', 'a @mapua.edu.ph', 'a@mapua.edu.ph.evil.com', 5, null]) assert.equal(isSchoolEmail(email), false);
});
test('queue requires a real session and handles repeated joins and cancellation', async () => {
  assert.equal((await request('/api/match/join', undefined, { sessionId: 'fake', handle: 'fake' })).status, 401);
  const a = identity();
  assert.equal((await request('/api/match/join', a, {})).data.status, 'queued');
  assert.equal((await request('/api/match/join', a, {})).data.status, 'queued');
  assert.equal((await request('/api/auth/reroll', a, {})).status, 409);
  await request('/api/match/cancel', a, {});
  assert.equal((await request('/api/match/poll', a)).data.status, 'idle');
});
test('HTTP matching, member-only messages, idempotent delivery, typing and immediate purge', async () => {
  const { a, b, roomId } = await pair();
  const outsider = identity();
  const match = (await request('/api/match/poll', a)).data;
  assert.equal(match.roomId, roomId);
  assert.equal(match.topic, 'Calculus');
  assert.notEqual(match.peer.sessionId, b.token);
  assert.equal(JSON.stringify(match).includes(b.email), false);
  assert.equal((await request('/api/chat/send', outsider, { roomId, text: 'intrusion' })).status, 404);
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, outsider)).data.active, false);
  await request('/api/chat/leave', outsider, { roomId });
  const payload = { roomId, text: 'Can we compare solutions?', clientMessageId: 'retry-id', senderHandle: 'spoofed' };
  const sent = (await request('/api/chat/send', a, payload)).data.message;
  assert.equal(sent.senderHandle, a.sessionHandle);
  await request('/api/chat/send', a, payload);
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, b)).data.messages.length, 1);
  for (const text of ['', ' ', 12, 'x'.repeat(4001)]) assert.equal((await request('/api/chat/send', a, { roomId, text })).status, 400);
  await request('/api/chat/typing', a, { roomId, isTyping: true });
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, b)).data.isPeerTyping, true);
  await request('/api/chat/leave', a, { roomId });
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, b)).data.active, false);
  assert.equal((await request('/api/match/poll', b)).data.status, 'idle');
  assert.equal((await request('/api/match/join', a, {})).data.status, 'queued');
  assert.equal((await request('/api/match/join', b, {})).data.status, 'matched');
  await request('/api/match/cancel', a, {});
});
test('verified sessions do not match demo sessions', async () => {
  const a = identity(), verified = identity(true), b = identity();
  await request('/api/match/join', a, {});
  assert.equal((await request('/api/match/join', verified, {})).data.status, 'queued');
  assert.equal((await request('/api/match/join', b, {})).data.status, 'matched');
  await request('/api/match/cancel', a, {});
  await request('/api/match/cancel', verified, {});
});
test('WebSocket and REST clients share the same room and recover after transport loss', async () => {
  const a = identity(), b = identity();
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat');
  const events: any[] = [];
  ws.on('message', raw => events.push(JSON.parse(raw.toString())));
  await new Promise<void>(resolve => ws.once('open', resolve));
  ws.send(JSON.stringify({ type: 'join_queue', token: a.token, interests: ['Physics'] }));
  await waitFor(() => events.some(e => e.type === 'queued'));
  const result = await request('/api/match/join', b, { interests: ['Physics'] });
  await waitFor(() => events.some(e => e.type === 'matched'));
  const roomId = result.data.roomId;
  await request('/api/chat/send', b, { roomId, text: 'One delivery', clientMessageId: 'one' });
  await waitFor(() => events.some(e => e.type === 'new_message'));
  assert.equal(events.filter(e => e.type === 'new_message').length, 1);
  ws.close();
  await new Promise<void>(resolve => ws.once('close', () => resolve()));
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, a)).data.messages.length, 1);
  await request('/api/auth/logout', b, {});
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, a)).data.peerDisconnected, true);
  assert.equal((await request('/api/match/poll', b)).status, 401);
});
test('WebSocket rejects fake credentials', async () => {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat');
  await new Promise<void>(resolve => ws.once('open', resolve));
  const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)));
  ws.send(JSON.stringify({ type: 'join_queue', token: 'fake' }));
  assert.equal(await closed, 1008);
});
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for WebSocket event');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
