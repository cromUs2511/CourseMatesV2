import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachRuntime, issueSession, isValidEmail } from '../runtime';

const app = express();
app.use(express.json());
const server = http.createServer(app);
const adminPassword = 'test-admin-password-longer-than-32-characters';
const stop = attachRuntime(app, server, {
  adminUsername: 'test-admin',
  adminPassword,
});
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

test('admin sign-in issues an HttpOnly session cookie and protects moderation APIs', async () => {
  const denied = await fetch(base + '/api/admin/reports');
  assert.equal(denied.status, 401);

  const invalid = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'test-admin', password: 'incorrect' }),
  });
  assert.equal(invalid.status, 401);

  const login = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'test-admin', password: adminPassword }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  if (!setCookie) throw new Error('Successful admin login did not issue a cookie.');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';', 1)[0];
  if (!cookie) throw new Error('Successful admin login returned an empty cookie.');
  assert.deepEqual(
    await (await fetch(base + '/api/admin/session', { headers: { Cookie: cookie } })).json(),
    {
      authenticated: true,
    },
  );
  const moderationData = await fetch(base + '/api/admin/reports', {
    headers: { Cookie: cookie },
  });
  assert.equal(moderationData.status, 200);
  assert.deepEqual(await moderationData.json(), { bans: [], reports: [] });
  await fetch(base + '/api/admin/logout', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base },
  });
  assert.deepEqual(
    await (await fetch(base + '/api/admin/session', { headers: { Cookie: cookie } })).json(),
    {
      authenticated: false,
    },
  );
});
const identity = (verified = false) => issueSession('test@gmail.com', {}, verified);
async function request(path: string, session?: ReturnType<typeof identity>, body?: unknown) {
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
  return { a, b, roomId: result.data.roomId };
}
test('email validation rejects malformed addresses and invalid types', () => {
  for (const email of ['a@gmail.com', 'student@example.org'])
    assert.equal(isValidEmail(email), true);
  for (const email of ['@gmail.com', 'a@@gmail.com', 'a gmail.com', 'a@gmail', 5, null])
    assert.equal(isValidEmail(email), false);
});
test('queue requires a real session and handles repeated joins and cancellation', async () => {
  assert.equal(
    (await request('/api/match/join', undefined, { sessionId: 'fake', handle: 'fake' })).status,
    401,
  );
  const a = identity();
  assert.equal((await request('/api/match/join', a, {})).data.status, 'queued');
  assert.equal((await request('/api/match/join', a, {})).data.status, 'queued');
  assert.equal((await request('/api/auth/reroll', a, {})).status, 409);
  await request('/api/match/cancel', a, {});
  assert.equal((await request('/api/match/poll', a)).data.status, 'idle');
});
test('custom handles are used throughout a chat and can be reset to a default handle', async () => {
  const a = identity();
  const b = identity();

  const saved = await request('/api/auth/handle', a, { name: 'Study Buddy' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.session.sessionHandle, 'Study Buddy');
  assert.equal(saved.data.session.customHandle, true);
  assert.equal((await request('/api/auth/session', a)).data.session.sessionHandle, 'Study Buddy');

  assert.equal(
    (await request('/api/match/join', a, { interests: ['Calculus'] })).data.status,
    'queued',
  );
  const matched = await request('/api/match/join', b, { interests: ['Calculus'] });
  assert.equal(matched.data.peer.handle, 'Study Buddy');

  const sent = await request('/api/chat/send', a, {
    roomId: matched.data.roomId,
    text: 'Hello!',
    clientMessageId: 'custom-handle-message',
  });
  assert.equal(sent.data.message.senderHandle, 'Study Buddy');

  assert.equal((await request('/api/auth/reroll', a, {})).status, 409);
  await request('/api/chat/leave', a, { roomId: matched.data.roomId });
  const reset = await request('/api/auth/reroll', a, {});
  assert.equal(reset.status, 200);
  assert.notEqual(reset.data.session.sessionHandle, 'Study Buddy');
  assert.equal(reset.data.session.customHandle, false);
});
test('chat intents match first and normal matching requires an explicit opt-in', async () => {
  const studyPeer = identity(),
    casualPeer = identity(),
    secondStudyPeer = identity();
  try {
    const first = await request('/api/match/join', studyPeer, { interests: ['Study / Help'] });
    assert.equal(first.data.status, 'queued');
    assert.equal(first.data.interestMatchUnavailable, true);

    const incompatible = await request('/api/match/join', casualPeer, {
      interests: ['Casual / Vent'],
    });
    assert.equal(incompatible.data.status, 'queued');
    assert.equal((await request('/api/match/poll', studyPeer)).data.status, 'queued');

    const intentMatch = await request('/api/match/join', secondStudyPeer, {
      interests: ['Study / Help'],
    });
    assert.equal(intentMatch.data.status, 'matched');
    assert.equal(intentMatch.data.peer.sessionId, studyPeer.id);
    assert.equal(intentMatch.data.topic, 'Study / Help');

    const normal = await request('/api/match/join', casualPeer, {
      interests: ['Casual / Vent'],
      allowNormal: true,
    });
    assert.equal(normal.data.status, 'queued');
    const noInterest = identity();
    const fallback = await request('/api/match/join', noInterest, { interests: [] });
    assert.equal(fallback.data.status, 'matched');
    assert.equal(fallback.data.peer.sessionId, casualPeer.id);
    assert.equal(fallback.data.topic, 'General Peer Discovery');
    await request('/api/match/cancel', noInterest, {});
  } finally {
    await request('/api/match/cancel', studyPeer, {});
    await request('/api/match/cancel', casualPeer, {});
    await request('/api/match/cancel', secondStudyPeer, {});
  }
});
test('HTTP matching, member-only messages, idempotent delivery, typing and immediate purge', async () => {
  const { a, b, roomId } = await pair();
  const outsider = identity();
  const match = (await request('/api/match/poll', a)).data;
  assert.equal(match.roomId, roomId);
  assert.equal(match.topic, 'Calculus');
  assert.notEqual(match.peer.sessionId, b.token);
  assert.equal(JSON.stringify(match).includes(b.email), false);
  assert.equal(
    (await request('/api/chat/send', outsider, { roomId, text: 'intrusion' })).status,
    404,
  );
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, outsider)).data.active, false);
  await request('/api/chat/leave', outsider, { roomId });
  const payload = {
    roomId,
    text: 'Can we compare solutions?',
    clientMessageId: 'retry-id',
    senderHandle: 'spoofed',
  };
  const sent = (await request('/api/chat/send', a, payload)).data.message;
  assert.equal(sent.senderHandle, a.sessionHandle);
  await request('/api/chat/send', a, payload);
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, b)).data.messages.length, 1);
  for (const text of ['', ' ', 12, 'x'.repeat(4001)])
    assert.equal((await request('/api/chat/send', a, { roomId, text })).status, 400);
  await request('/api/chat/typing', a, { roomId, isTyping: true });
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, b)).data.isPeerTyping, true);
  assert.equal(
    (await request('/api/chat/messages?roomId=' + roomId, b)).data.peerPresence,
    'active',
  );
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
    const message = (await request('/api/chat/send', a, { roomId, text: 'React here' })).data
      .message;
    const payload = { roomId, messageId: message.id, emoji: '❤️' };
    assert.equal((await request('/api/chat/react', identity(), payload)).status, 404);
    assert.equal(
      (await request('/api/chat/react', a, { ...payload, emoji: 'invalid' })).status,
      400,
    );
    await request('/api/chat/react', a, payload);
    await request('/api/chat/react', a, payload);
    await request('/api/chat/react', b, payload);
    assert.deepEqual(
      (await request('/api/chat/messages?roomId=' + roomId, b)).data.messages[0].reactions,
      { [a.id]: '❤️', [b.id]: '❤️' },
    );
    await request('/api/chat/react', a, { ...payload, emoji: '👍' });
    await request('/api/chat/react', b, { ...payload, emoji: null });
    assert.deepEqual(
      (await request('/api/chat/messages?roomId=' + roomId, b)).data.messages[0].reactions,
      { [a.id]: '👍' },
    );
    await request('/api/chat/delete', a, { roomId, messageId: message.id });
    assert.equal((await request('/api/chat/react', a, payload)).status, 404);
  } finally {
    await request('/api/match/cancel', a, {});
  }
});

test('message edits are member-only and shared with peers', async () => {
  const { a, b, roomId } = await pair();
  try {
    const original = (await request('/api/chat/send', a, { roomId, text: 'Original' })).data
      .message;
    assert.equal(
      (
        await request('/api/chat/edit', identity(), {
          roomId,
          messageId: original.id,
          text: 'Hacked',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request('/api/chat/edit', b, {
          roomId,
          messageId: original.id,
          text: 'By other peer',
        })
      ).status,
      400,
    );
    const edited = (
      await request('/api/chat/edit', a, { roomId, messageId: original.id, text: 'Edited message' })
    ).data.message;
    assert.equal(edited.text, 'Edited message');
    assert.equal(edited.edited, true);
    assert.equal(
      (await request('/api/chat/messages?roomId=' + roomId, b)).data.messages[0].text,
      'Edited message',
    );
    assert.equal(
      (await request('/api/chat/messages?roomId=' + roomId, b)).data.messages[0].edited,
      true,
    );
    assert.equal(
      (await request('/api/chat/edit', a, { roomId, messageId: original.id, text: '   ' })).status,
      400,
    );
  } finally {
    await request('/api/match/cancel', a, {});
  }
});

test('anonymous sessions share one matching pool after external auth removal', async () => {
  const a = identity(),
    verified = identity(true),
    b = identity();
  await request('/api/match/join', a, {});
  assert.equal((await request('/api/match/join', verified, {})).data.status, 'matched');
  assert.equal((await request('/api/match/poll', a)).data.status, 'matched');
  assert.equal((await request('/api/match/join', b, {})).data.status, 'queued');
  await request('/api/match/cancel', a, {});
  await request('/api/match/cancel', verified, {});
});

test('expired queue entries cannot consume an active student match', async () => {
  const expired = identity(),
    a = identity(),
    b = identity();
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
    const original = (await request('/api/chat/send', a, { roomId, text: 'Original text' })).data
      .message;
    const reply = (
      await request('/api/chat/send', b, {
        roomId,
        text: 'My reply',
        replyTo: { id: original.id, senderHandle: 'Impersonated name', text: 'Invented quote' },
      })
    ).data.message;
    assert.deepEqual(reply.replyTo, {
      id: original.id,
      senderHandle: a.sessionHandle,
      text: original.text,
    });
    await request('/api/chat/delete', a, { roomId, messageId: original.id });
    const messages = (await request('/api/chat/messages?roomId=' + roomId, b)).data.messages;
    assert.equal(
      messages.find((message: any) => message.id === reply.id).replyTo.text,
      'Message unsent.',
    );
    const staleReply = (
      await request('/api/chat/send', b, {
        roomId,
        text: 'Late reply',
        replyTo: { id: original.id, senderHandle: a.sessionHandle, text: original.text },
      })
    ).data.message;
    assert.equal(staleReply.replyTo.text, 'Message unsent.');
    const missingReply = await request('/api/chat/send', b, {
      roomId,
      text: 'Reply without a source',
      replyTo: { id: 'missing', senderHandle: 'Other person', text: 'Fake quote' },
    });
    assert.equal(missingReply.status, 400);
  } finally {
    await request('/api/match/cancel', a, {});
  }
});
test('WebSocket and REST clients share the same room and recover after transport loss', async () => {
  const a = identity(),
    b = identity();
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat', {
    headers: { Cookie: 'cm_session=' + a.token, Origin: base },
  });
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve) => ws.once('open', resolve));
  ws.send(JSON.stringify({ type: 'join_queue', interests: ['Physics'] }));
  await waitFor(() => events.some((e) => e.type === 'queued'));
  const result = await request('/api/match/join', b, { interests: ['Physics'] });
  await waitFor(() => events.some((e) => e.type === 'matched'));
  const roomId = result.data.roomId;
  await request('/api/chat/send', b, { roomId, text: 'One delivery', clientMessageId: 'one' });
  await waitFor(() => events.some((e) => e.type === 'new_message'));
  assert.equal(events.filter((e) => e.type === 'new_message').length, 1);
  const messageEvent = events.find((e) => e.type === 'new_message');
  assert.equal(Number.isInteger(messageEvent.revision), true);
  const unchanged = await request(
    '/api/chat/messages?roomId=' + roomId + '&sinceRevision=' + messageEvent.revision,
    a,
  );
  assert.deepEqual(unchanged.data.messages, []);
  assert.equal(unchanged.data.revision, messageEvent.revision);
  ws.close();
  await new Promise<void>((resolve) => ws.once('close', () => resolve()));
  assert.equal((await request('/api/chat/messages?roomId=' + roomId, a)).data.messages.length, 1);
  await request('/api/auth/logout', b, {});
  assert.equal(
    (await request('/api/chat/messages?roomId=' + roomId, a)).data.peerDisconnected,
    true,
  );
  assert.equal((await request('/api/match/poll', b)).status, 401);
});
test('WebSocket rejects fake credentials', async () => {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat', {
    headers: { Cookie: 'cm_session=fake', Origin: base },
  });
  const status = await new Promise<number>((resolve) => {
    ws.once('unexpected-response', (_req, res) => {
      const statusCode = res.statusCode!;
      res.once('end', () => resolve(statusCode));
      res.resume();
    });
    ws.on('error', () => {});
  });
  assert.equal(status, 401);
});

test('session responses exclude credentials and bearer authentication is rejected', async () => {
  const a = identity();
  const result = await request('/api/auth/session', a);
  assert.equal(result.data.session.id, a.id);
  assert.equal(result.data.session.token, undefined);
  assert.equal(result.data.session.email, undefined);
  assert.equal(result.data.session.actor, undefined);
  const bearer = await fetch(base + '/api/match/poll', {
    headers: { Authorization: 'Bearer ' + a.token },
  });
  assert.equal(bearer.status, 401);
});

test('shared music queue advances once and stops when its final track ends', async () => {
  const { a, b, roomId } = await pair();
  const first = {
    id: 'queue-first',
    title: 'First track',
    artist: 'Test artist',
    youtubeVideoId: 'dQw4w9WgXcQ',
  };
  const second = {
    id: 'queue-second',
    title: 'Second track',
    artist: 'Test artist',
    youtubeVideoId: 's3a4OQR-10M',
  };
  const third = {
    id: 'queue-third',
    title: 'Third track',
    artist: 'Test artist',
    youtubeVideoId: 'yGHEis32s2Y',
  };
  const start = await request('/api/chat/music', a, {
    roomId,
    trackId: first.id,
    track: first,
    queue: [second, third],
    isPlaying: true,
  });
  assert.equal(start.status, 200);

  const next = await request('/api/chat/music/next', b, {
    roomId,
    trackId: first.id,
    revision: start.data.music.revision,
  });
  assert.equal(next.data.music.trackId, second.id);
  assert.deepEqual(
    next.data.music.queue.map((track: { id: string }) => track.id),
    [third.id],
  );
  assert.equal(next.data.music.isPlaying, true);

  const duplicate = await request('/api/chat/music/next', a, {
    roomId,
    trackId: first.id,
    revision: start.data.music.revision,
  });
  assert.equal(duplicate.data.music.revision, next.data.music.revision);
  assert.equal(duplicate.data.music.trackId, second.id);

  const last = await request('/api/chat/music/next', a, {
    roomId,
    trackId: second.id,
    revision: next.data.music.revision,
  });
  assert.equal(last.data.music.trackId, third.id);
  assert.equal(last.data.music.isPlaying, true);

  const stopped = await request('/api/chat/music/next', b, {
    roomId,
    trackId: third.id,
    revision: last.data.music.revision,
  });
  assert.equal(stopped.data.music.isPlaying, false);
  assert.equal(stopped.data.music.ended, true);
  assert.equal(stopped.data.music.position, 0);
  assert.deepEqual(stopped.data.music.queue, []);
});

test('foreign-origin WebSocket upgrade fails even with a valid cookie', async () => {
  const a = identity();
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat', {
    headers: { Cookie: 'cm_session=' + a.token, Origin: 'https://evil.example' },
  });
  const status = await new Promise<number>((resolve) => {
    ws.once('unexpected-response', (_req, res) => {
      const statusCode = res.statusCode!;
      res.once('end', () => resolve(statusCode));
      res.resume();
    });
    ws.on('error', () => {});
  });
  assert.equal(status, 403);
});
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for WebSocket event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('message IDs are unique across peers and deletion leaves an unsent placeholder', async () => {
  const { a, b, roomId } = await pair();
  try {
    const first = (
      await request('/api/chat/send', a, { roomId, text: 'First', clientMessageId: 'shared-id' })
    ).data.message;
    const second = (
      await request('/api/chat/send', b, { roomId, text: 'Second', clientMessageId: 'shared-id' })
    ).data.message;
    assert.notEqual(first.id, second.id);
    const retry = (
      await request('/api/chat/send', b, { roomId, text: 'Second', clientMessageId: 'shared-id' })
    ).data.message;
    assert.equal(retry.id, second.id);
    assert.equal(
      (await request('/api/chat/delete', b, { roomId, messageId: first.id })).status,
      400,
    );
    assert.equal(
      (await request('/api/chat/delete', b, { roomId, messageId: second.id })).status,
      200,
    );
    const remaining = (await request('/api/chat/messages?roomId=' + roomId, a)).data.messages;
    assert.deepEqual(
      remaining.map((m: any) => m.id),
      [first.id, second.id],
    );
    assert.equal(remaining[1].type, 'system');
    assert.equal(remaining[1].text, 'Message unsent.');
  } finally {
    await request('/api/match/cancel', a, {});
  }
});

test('music snippets sync to a peer, validate their window, and disappear when unsent', async () => {
  const { a, b, roomId } = await pair();
  const musicSnippet = {
    trackId: 'track-brand-new-day-loser',
    title: 'Loser',
    artist: 'Tame Impala',
    artworkUrl: 'https://example.invalid/forged.png',
    youtubeId: 's3a4OQR-10M',
    startTime: 45,
    duration: 30,
    caption: 'This part is my favorite',
  };
  try {
    const result = await request('/api/chat/send', a, {
      roomId,
      text: '',
      musicSnippet,
      clientMessageId: 'snippet-1',
    });
    assert.equal(result.status, 200);
    const sent = result.data.message;
    assert.equal(sent.text, musicSnippet.caption);
    assert.deepEqual(sent.musicSnippet, {
      ...musicSnippet,
      artworkUrl: 'https://img.youtube.com/vi/s3a4OQR-10M/hqdefault.jpg',
    });
    const received = (await request('/api/chat/messages?roomId=' + roomId, b)).data.messages.find(
      (message: any) => message.id === sent.id,
    );
    assert.deepEqual(received.musicSnippet, sent.musicSnippet);
    assert.equal(
      (
        await request('/api/chat/send', a, {
          roomId,
          text: '',
          musicSnippet,
          clientMessageId: 'snippet-1',
        })
      ).data.message.id,
      sent.id,
    );
    for (const invalid of [
      { ...musicSnippet, duration: 14 },
      { ...musicSnippet, duration: 31 },
      { ...musicSnippet, startTime: -1 },
      { ...musicSnippet, youtubeId: 'invalid' },
      { ...musicSnippet, caption: 'x'.repeat(281) },
    ])
      assert.equal(
        (await request('/api/chat/send', a, { roomId, text: '', musicSnippet: invalid })).status,
        400,
      );
    assert.equal(
      (await request('/api/chat/edit', a, { roomId, messageId: sent.id, text: 'Changed' })).status,
      400,
    );
    assert.equal(
      (await request('/api/chat/delete', b, { roomId, messageId: sent.id })).status,
      400,
    );
    assert.equal(
      (await request('/api/chat/delete', a, { roomId, messageId: sent.id })).status,
      200,
    );
    const afterDelete = (
      await request('/api/chat/messages?roomId=' + roomId, b)
    ).data.messages.find((message: any) => message.id === sent.id);
    assert.equal(afterDelete.musicSnippet, undefined);
  } finally {
    await request('/api/match/cancel', a, {});
  }
});

test('shared music survives HTTP fallback and rejects invalid tracks and non-members', async () => {
  const { a, b, roomId } = await pair();
  const track = { id: 'custom-dQw4w9WgXcQ', youtubeVideoId: 'dQw4w9WgXcQ', title: 'Shared track' };
  const update = { roomId, trackId: track.id, track, isPlaying: true, volume: 70, isMuted: false };
  try {
    assert.equal((await request('/api/chat/music', undefined, update)).status, 401);
    assert.equal((await request('/api/chat/music', identity(), update)).status, 404);
    assert.equal(
      (
        await request('/api/chat/music', a, {
          ...update,
          track: { ...track, youtubeVideoId: 'invalid' },
        })
      ).status,
      400,
    );
    const first = await request('/api/chat/music', a, update);
    assert.equal(first.status, 200);
    const received = (await request('/api/chat/messages?roomId=' + roomId, b)).data.music;
    assert.equal(received.track.youtubeVideoId, track.youtubeVideoId);
    assert.equal(received.isPlaying, true);
    const paused = await request('/api/chat/music', b, { ...update, isPlaying: false });
    assert.ok(paused.data.music.revision > received.revision);
    assert.equal(
      (await request('/api/chat/messages?roomId=' + roomId, a)).data.music.isPlaying,
      false,
    );
  } finally {
    await request('/api/match/cancel', a, {});
  }
});

test('Tic Tac Toe REST and socket snapshots agree and room departure purges the game', async () => {
  const { a, b, roomId } = await pair();
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat', {
    headers: { Cookie: 'cm_session=' + b.token, Origin: base },
  });
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve) => ws.once('open', resolve));
  ws.send(JSON.stringify({ type: 'join_queue', interests: [] }));
  await waitFor(() => events.some((e) => e.type === 'queued' || e.type === 'matched'));
  try {
    const path = '/api/chat/tictactoe';
    assert.equal((await request(path + '?roomId=' + roomId)).status, 401);
    assert.equal((await request(path, identity(), { roomId, action: 'invite' })).status, 404);
    const invitation = (await request(path, a, { roomId, action: 'invite' })).data;
    await waitFor(() => events.some((event) => event.type === 'tictactoe_state'));
    assert.deepEqual(events.find((event) => event.type === 'tictactoe_state').state, invitation);
    const accepted = await request(path, b, {
      roomId,
      action: 'respond',
      invitationId: invitation.invitation.id,
      accept: true,
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual((await request(path + '?roomId=' + roomId, a)).data, accepted.data);
    ws.close();
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
    const action = {
      roomId,
      action: 'move',
      gameId: accepted.data.game.id,
      round: 1,
      revision: accepted.data.revision,
      square: 0,
    };
    assert.equal((await request(path, b, action)).status, 409);
    const moved = (await request(path, a, action)).data;
    assert.equal(moved.game.board[0], 'X');
    assert.deepEqual((await request(path + '?roomId=' + roomId, b)).data, moved);
    assert.equal((await request(path, a, action)).status, 409);
    await request('/api/chat/leave', a, { roomId });
    assert.equal((await request(path + '?roomId=' + roomId, b)).status, 404);
    assert.equal((await request('/api/uno/arena', a, { size: 4, opponents: 'bots' })).status, 410);
  } finally {
    ws.close();
    await request('/api/match/cancel', a, {});
  }
});

test('shared playback retains its clock across pauses, polls, restart and track changes', async () => {
  const { a, b, roomId } = await pair();
  const update = {
    roomId,
    trackId: 'test',
    isPlaying: true,
    volume: 70,
    isMuted: false,
    position: 42,
  };
  try {
    const first = (await request('/api/chat/music', a, update)).data.music;
    assert.equal(first.position, 42);
    assert.ok(first.updatedAt <= first.serverNow);
    const poll = (await request('/api/chat/messages?roomId=' + roomId, b)).data.music;
    assert.equal(poll.updatedAt, first.updatedAt);
    assert.equal(poll.revision, first.revision);
    const paused = (
      await request('/api/chat/music', b, { ...update, isPlaying: false, position: 47 })
    ).data.music;
    assert.equal(paused.position, 47);
    const restart = (await request('/api/chat/music', a, { ...update, position: 0 })).data.music;
    assert.equal(restart.position, 0);
    const next = (
      await request('/api/chat/music', b, { ...update, trackId: 'next', position: undefined })
    ).data.music;
    assert.equal(next.position, 0);
    for (const position of [-1, '0', 604801])
      assert.equal((await request('/api/chat/music', a, { ...update, position })).status, 400);
    // The rollout switch preserves the original play/pause contract for old clients.
    process.env.CHAT_MULTIPLAYER_V2 = 'false';
    const legacy = (await request('/api/chat/music', a, update)).data.music;
    assert.equal(legacy.position, undefined);
    assert.equal(legacy.isPlaying, true);
    assert.equal((await request('/api/chat/tictactoe?roomId=' + roomId, a)).status, 503);
  } finally {
    delete process.env.CHAT_MULTIPLAYER_V2;
    await request('/api/match/cancel', a, {});
  }
});
