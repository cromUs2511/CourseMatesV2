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
test('reactions are member-only, replaceable, removable and shared through polling', async () => {
  const { a, b, roomId } = await pair();
  try {
    const message = (await request('/api/chat/send', a, { roomId, text: 'React here' })).data.message;
    const payload = { roomId, messageId: message.id, emoji: '❤️' };
    assert.equal((await request('/api/chat/react', identity(), payload)).status, 404);
    assert.equal((await request('/api/chat/react', a, { ...payload, emoji: 'invalid' })).status, 400);
    await request('/api/chat/react', a, payload);
    await request('/api/chat/react', a, payload);
    await request('/api/chat/react', b, payload);
    assert.deepEqual((await request('/api/chat/messages?roomId=' + roomId, b)).data.messages[0].reactions, { [a.id]: '❤️', [b.id]: '❤️' });
    await request('/api/chat/react', a, { ...payload, emoji: '👍' });
    await request('/api/chat/react', b, { ...payload, emoji: null });
    assert.deepEqual((await request('/api/chat/messages?roomId=' + roomId, b)).data.messages[0].reactions, { [a.id]: '👍' });
    await request('/api/chat/delete', a, { roomId, messageId: message.id });
    assert.equal((await request('/api/chat/react', a, payload)).status, 404);
  } finally { await request('/api/match/cancel', a, {}); }
});

test('verified sessions do not match demo sessions', async () => {
  const a = identity(), verified = identity(true), b = identity();
  await request('/api/match/join', a, {});
  assert.equal((await request('/api/match/join', verified, {})).data.status, 'queued');
  assert.equal((await request('/api/match/join', b, {})).data.status, 'matched');
  await request('/api/match/cancel', a, {});
  await request('/api/match/cancel', verified, {});
});

test('expired queue entries cannot consume an active student match', async () => {
  const expired = identity(), a = identity(), b = identity();
  await request('/api/match/join', expired, {});
  expired.expiresAt = Date.now() - 1;
  try {
    assert.equal((await request('/api/match/join', a, {})).data.status, 'queued');
    const result = await request('/api/match/join', b, {});
    assert.equal(result.data.status, 'matched');
    assert.equal(result.data.peer.sessionId, a.id);
  } finally {
    await request('/api/match/cancel', a, {});
    await request('/api/match/cancel', b, {});
  }
});

test('reply previews use the original message and clear text when it is unsent', async () => {
  const { a, b, roomId } = await pair();
  try {
    const original = (await request('/api/chat/send', a, { roomId, text: 'Original text' })).data.message;
    const reply = (await request('/api/chat/send', b, {
      roomId, text: 'My reply', replyTo: { id: original.id, senderHandle: 'Impersonated name', text: 'Invented quote' },
    })).data.message;
    assert.deepEqual(reply.replyTo, { id: original.id, senderHandle: a.sessionHandle, text: original.text });
    await request('/api/chat/delete', a, { roomId, messageId: original.id });
    const messages = (await request('/api/chat/messages?roomId=' + roomId, b)).data.messages;
    assert.equal(messages.find((message: any) => message.id === reply.id).replyTo.text, 'Message unsent.');
    const staleReply = (await request('/api/chat/send', b, {
      roomId, text: 'Late reply', replyTo: { id: original.id, senderHandle: a.sessionHandle, text: original.text },
    })).data.message;
    assert.equal(staleReply.replyTo.text, 'Message unsent.');
    const missingReply = await request('/api/chat/send', b, {
      roomId, text: 'Reply without a source', replyTo: { id: 'missing', senderHandle: 'Other person', text: 'Fake quote' },
    });
    assert.equal(missingReply.status, 400);
  } finally { await request('/api/match/cancel', a, {}); }
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


test('message IDs are unique across peers and deletion leaves an unsent placeholder', async () => {
  const { a, b, roomId } = await pair();
  try {
    const first = (await request('/api/chat/send', a, { roomId, text: 'First', clientMessageId: 'shared-id' })).data.message;
    const second = (await request('/api/chat/send', b, { roomId, text: 'Second', clientMessageId: 'shared-id' })).data.message;
    assert.notEqual(first.id, second.id);
    const retry = (await request('/api/chat/send', b, { roomId, text: 'Second', clientMessageId: 'shared-id' })).data.message;
    assert.equal(retry.id, second.id);
    assert.equal((await request('/api/chat/delete', b, { roomId, messageId: first.id })).status, 400);
    assert.equal((await request('/api/chat/delete', b, { roomId, messageId: second.id })).status, 200);
    const remaining = (await request('/api/chat/messages?roomId=' + roomId, a)).data.messages;
    assert.deepEqual(remaining.map((m: any) => m.id), [first.id, second.id]);
    assert.equal(remaining[1].type, 'system');
    assert.equal(remaining[1].text, 'Message unsent.');
  } finally { await request('/api/match/cancel', a, {}); }
});

test('shared music survives HTTP fallback and rejects invalid tracks and non-members', async () => {
  const { a, b, roomId } = await pair();
  const track = { id: 'custom-dQw4w9WgXcQ', youtubeVideoId: 'dQw4w9WgXcQ', title: 'Shared track' };
  const update = { roomId, trackId: track.id, track, isPlaying: true, volume: 70, isMuted: false };
  try {
    assert.equal((await request('/api/chat/music', undefined, update)).status, 401);
    assert.equal((await request('/api/chat/music', identity(), update)).status, 404);
    assert.equal((await request('/api/chat/music', a, { ...update, track: { ...track, youtubeVideoId: 'invalid' } })).status, 400);
    const first = await request('/api/chat/music', a, update);
    assert.equal(first.status, 200);
    const received = (await request('/api/chat/messages?roomId=' + roomId, b)).data.music;
    assert.equal(received.track.youtubeVideoId, track.youtubeVideoId);
    assert.equal(received.isPlaying, true);
    const paused = await request('/api/chat/music', b, { ...update, isPlaying: false });
    assert.ok(paused.data.music.revision > received.revision);
    assert.equal((await request('/api/chat/messages?roomId=' + roomId, a)).data.music.isPlaying, false);
  } finally { await request('/api/match/cancel', a, {}); }
});
