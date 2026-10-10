import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { WebSocket } from 'ws';
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
async function fetchMessages(session: Session, roomId: string) {
  const response = await request('/api/chat/messages?roomId=' + roomId, session);
  assert.equal(response.status, 200);
  return response.data.messages as any[];
}
async function waitFor(check: () => boolean, label = 'Event not received') {
  const until = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > until) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('game-leave notices keep their chronological position and arrive exactly once', async () => {
  const { a, b, roomId } = await pair();
  const eventsA: any[] = [];
  const eventsB: any[] = [];
  const wsA = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat', {
    headers: { Cookie: 'cm_session=' + a.token, Origin: base },
  });
  const wsB = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat', {
    headers: { Cookie: 'cm_session=' + b.token, Origin: base },
  });
  wsA.on('error', () => {});
  wsB.on('error', () => {});
  try {
    wsA.on('message', (raw) => eventsA.push(JSON.parse(raw.toString())));
    wsB.on('message', (raw) => eventsB.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => wsA.once('open', () => resolve()));
    await new Promise<void>((resolve) => wsB.once('open', () => resolve()));
    // Bind both sockets to the room without disturbing the match.
    wsA.send(JSON.stringify({ type: 'join_queue', interests: [] }));
    wsB.send(JSON.stringify({ type: 'join_queue', interests: [] }));
    await waitFor(
      () =>
        eventsA.some((event) => event.type === 'matched') &&
        eventsB.some((event) => event.type === 'matched'),
    );

    assert.equal(
      (await request('/api/chat/send', a, { roomId, text: 'before the game' })).status,
      200,
    );
    const invite = await request('/api/chat/drawing', b, {
      roomId,
      action: 'invite',
      category: 'all',
      difficulty: 'mixed',
    });
    assert.equal(invite.status, 200);
    const accepted = await request('/api/chat/drawing', a, {
      roomId,
      action: 'respond',
      invitationId: invite.data.invitation.id,
      accept: true,
    });
    assert.equal(accepted.status, 200);
    assert.equal((await request('/api/chat/drawing', b, { roomId, action: 'leave' })).status, 200);
    assert.equal(
      (await request('/api/chat/send', a, { roomId, text: 'after the leave one' })).status,
      200,
    );
    assert.equal(
      (await request('/api/chat/send', b, { roomId, text: 'after the leave two' })).status,
      200,
    );

    const expected = `${b.sessionHandle} left the Draw & Guess game.`;
    // Live updates: both peers receive the notice over the socket, exactly once
    // and before the messages sent afterward.
    await waitFor(
      () =>
        eventsA.some((event) => event.type === 'new_message' && event.message?.text === expected) &&
        eventsB.some((event) => event.type === 'new_message' && event.message?.text === expected),
      'Leave notice not received live',
    );
    for (const [name, events] of [
      ['a', eventsA],
      ['b', eventsB],
    ] as const) {
      const live = events
        .filter((event) => event.type === 'new_message')
        .map((event) => event.message.text);
      assert.equal(
        live.filter((text) => text === expected).length,
        1,
        `${name} receives the leave notice exactly once live`,
      );
      assert.ok(live.indexOf('before the game') < live.indexOf(expected), name);
      assert.ok(live.indexOf(expected) < live.indexOf('after the leave one'), name);
      assert.ok(live.indexOf(expected) < live.indexOf('after the leave two'), name);
    }

    // REST polling fallback: repeated polls keep one notice in place.
    for (const [name, snapshot] of [
      ['poll 1', await fetchMessages(a, roomId)],
      ['poll 2', await fetchMessages(b, roomId)],
    ] as const) {
      const notices = snapshot.filter((message) => message.text === expected);
      assert.equal(notices.length, 1, `${name} sees the leave notice exactly once`);
      assert.equal(notices[0].type, 'system', name);
      const texts = snapshot.map((message) => message.text);
      assert.ok(texts.indexOf('before the game') < texts.indexOf(expected), name);
      assert.ok(texts.indexOf(expected) < texts.indexOf('after the leave one'), name);
      assert.ok(texts.indexOf(expected) < texts.indexOf('after the leave two'), name);
    }

    // Retried and game-less leaves never duplicate the notice.
    assert.equal((await request('/api/chat/drawing', b, { roomId, action: 'leave' })).status, 200);
    assert.equal((await request('/api/chat/drawing', a, { roomId, action: 'leave' })).status, 200);
    const afterRetries = await fetchMessages(a, roomId);
    assert.equal(afterRetries.filter((message) => message.text === expected).length, 1);
  } finally {
    wsA.terminate();
    wsB.terminate();
    await request('/api/chat/leave', a, { roomId });
  }
});

test('every peer game posts its leave notice to the timeline exactly once', async () => {
  const games = [
    { path: '/api/chat/tictactoe', label: 'Tic Tac Toe', invite: { action: 'invite' } },
    { path: '/api/chat/rps', label: 'Rock Paper Scissors', invite: { action: 'invite' } },
    { path: '/api/chat/connectfour', label: 'Connect Four', invite: { action: 'invite' } },
    { path: '/api/chat/chess', label: 'Chess', invite: { action: 'invite' } },
    {
      path: '/api/chat/trivia',
      label: 'Trivia',
      invite: { action: 'invite', category: 'general' },
    },
    {
      path: '/api/chat/wyr',
      label: 'Would You Rather',
      invite: { action: 'invite', category: 'Random' },
    },
    {
      path: '/api/chat/drawing',
      label: 'Draw & Guess',
      invite: { action: 'invite', category: 'all', difficulty: 'mixed' },
    },
  ];
  for (const game of games) {
    const { a, b, roomId } = await pair();
    try {
      const invite = await request(game.path, a, { roomId, ...game.invite });
      assert.equal(invite.status, 200, game.label);
      const accepted = await request(game.path, b, {
        roomId,
        action: 'respond',
        invitationId: invite.data.invitation.id,
        accept: true,
      });
      assert.equal(accepted.status, 200, game.label);
      assert.equal(
        (await request(game.path, b, { roomId, action: 'leave' })).status,
        200,
        game.label,
      );
      assert.equal(
        (await request('/api/chat/send', a, { roomId, text: 'still chatting' })).status,
        200,
        game.label,
      );
      const snapshot = await fetchMessages(a, roomId);
      const expected = `${b.sessionHandle} left the ${game.label} game.`;
      const notices = snapshot.filter((message) => message.text === expected);
      assert.equal(notices.length, 1, game.label);
      assert.equal(notices[0].type, 'system', game.label);
      const texts = snapshot.map((message) => message.text);
      assert.ok(texts.indexOf(expected) < texts.indexOf('still chatting'), game.label);
    } finally {
      await request('/api/chat/leave', a, { roomId });
    }
  }
});
