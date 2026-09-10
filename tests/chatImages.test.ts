import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { attachRuntime, issueSession } from '../runtime';
import { parseImages } from '../chatImages';
import { CHAT_SEND_BODY_LIMIT } from '../src/data/chatImages';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const photo = { name: 'Notes.png', dataUrl: 'data:image/png;base64,' + png, width: 1, height: 1 };
const app = express();
app.use(express.json({ limit: CHAT_SEND_BODY_LIMIT }));
const server = http.createServer(app);
const stop = attachRuntime(app, server);
let base: string;
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
after(async () => { stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const identity = () => issueSession('photos@mymail.mapua.edu.ph');
async function request(path: string, session?: ReturnType<typeof identity>, body?: unknown) {
  return fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('photo validation rejects unsupported, spoofed, oversized, and malformed uploads', () => {
  assert.equal(parseImages([photo])[0].bytes.toString('base64'), png);
  for (const images of [null, {}, Array(5).fill(photo), [{ ...photo, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    [{ ...photo, dataUrl: 'data:image/jpeg;base64,' + png }], [{ ...photo, dataUrl: 'data:image/png;base64,SGVsbG8=' }],
    [{ ...photo, dataUrl: 'data:image/png;base64,' + 'a'.repeat(1500000) }], [{ ...photo, width: 1601 }], [{ ...photo, height: -1 }]]) {
    assert.throws(() => parseImages(images));
  }
});

test('photo-only messages are private, retry-safe, available to both peers and purged on delete or leave', async () => {
  const a = identity(), b = identity(), outsider = identity();
  await request('/api/match/join', a, {});
  const { roomId } = await (await request('/api/match/join', b, {})).json();
  try {
    const payload = { roomId, text: '', images: [photo, { ...photo, name: 'Second.png' }], clientMessageId: 'photos-retry' };
    assert.equal((await request('/api/chat/send', outsider, payload)).status, 404);
    const response = await request('/api/chat/send', a, payload);
    assert.equal(response.status, 200);
    const { message } = await response.json();
    assert.equal(message.images.length, 2);
    assert.equal((await (await request('/api/chat/send', a, payload)).json()).message.id, message.id);
    const received = await (await request('/api/chat/messages?roomId=' + roomId, b)).json();
    assert.equal(received.messages.length, 1);
    assert.deepEqual(received.messages[0].images, message.images);
    assert.equal(JSON.stringify(received).includes(png), false);
    const url = message.images[0].url;
    assert.equal((await request(url)).status, 401);
    assert.equal((await request(url, outsider)).status, 404);
    for (const peer of [a, b]) {
      const image = await request(url, peer);
      assert.equal(image.headers.get('content-type'), 'image/png');
      assert.equal(image.headers.get('cache-control'), 'no-store');
      assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), png);
    }
    assert.equal((await request('/api/chat/delete', b, { roomId, messageId: message.id })).status, 400);
    await request('/api/chat/delete', a, { roomId, messageId: message.id });
    assert.equal((await request(url, b)).status, 404);
    const next = await (await request('/api/chat/send', a, { ...payload, text: 'My notes', clientMessageId: 'next-photo' })).json();
    await request('/api/chat/leave', a, { roomId });
    assert.equal((await request(next.message.images[0].url, b)).status, 404);
  } finally { await request('/api/match/cancel', a, {}); }
});

test('evicting an old message also removes its photo', async () => {
  const a = identity(), b = identity();
  await request('/api/match/join', a, {});
  const { roomId } = await (await request('/api/match/join', b, {})).json();
  try {
    const { message } = await (await request('/api/chat/send', a, { roomId, text: '', images: [photo] })).json();
    for (let index = 0; index < 500; index++) await (await request('/api/chat/send', a, { roomId, text: 'Message ' + index })).json();
    assert.equal((await request(message.images[0].url, b)).status, 404);
    assert.equal((await (await request('/api/chat/messages?roomId=' + roomId, b)).json()).messages.length, 500);
  } finally { await request('/api/match/cancel', a, {}); }
});
