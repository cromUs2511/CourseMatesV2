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
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  stop();
  server.closeIdleConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
type Session = ReturnType<typeof issueSession>;
const identity = () => issueSession('test@gmail.com', {}, false);
async function request(path: string, session?: Session, body?: unknown) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(session ? { Cookie: 'cm_session=' + session.token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, data: await res.json() };
}
async function pair() {
  const a = identity(),
    b = identity();
  await request('/api/match/join', a, { interests: ['Drawing'] });
  const result = await request('/api/match/join', b, { interests: ['Drawing'] });
  return { a, b, roomId: result.data.roomId as string };
}
async function waitFor(check: () => boolean) {
  const until = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > until) throw new Error('Event not received');
    await new Promise((r) => setTimeout(r, 10));
  }
}
test('drawing HTTP requires room membership and holds the existing game slot', async () => {
  const { a, b, roomId } = await pair();
  try {
    assert.equal((await request('/api/chat/drawing?roomId=' + roomId)).status, 401);
    assert.equal((await request('/api/chat/drawing?roomId=' + roomId, identity())).status, 404);
    const invite = await request('/api/chat/drawing', a, {
      roomId,
      action: 'invite',
      category: 'all',
      difficulty: 'mixed',
    });
    assert.equal(invite.status, 200);
    assert.equal(
      (await request('/api/chat/tictactoe', b, { roomId, action: 'invite' })).status,
      409,
    );
    const accepted = await request('/api/chat/drawing', b, {
      roomId,
      action: 'respond',
      invitationId: invite.data.invitation.id,
      accept: true,
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.data.game.choices, []);
    await request('/api/chat/drawing', b, { roomId, action: 'leave' });
    assert.equal(
      (await request('/api/chat/tictactoe', b, { roomId, action: 'invite' })).status,
      200,
    );
    assert.equal(
      (
        await request('/api/chat/drawing', a, {
          roomId,
          action: 'invite',
          category: 'all',
          difficulty: 'easy',
        })
      ).status,
      409,
    );
  } finally {
    await request('/api/chat/leave', a, { roomId });
  }
});
test('a completed existing game cannot rematch over an active drawing game', async () => {
  const { a, b, roomId } = await pair();
  try {
    const invitation = await request('/api/chat/tictactoe', a, { roomId, action: 'invite' });
    let state = (
      await request('/api/chat/tictactoe', b, {
        roomId,
        action: 'respond',
        invitationId: invitation.data.invitation.id,
        accept: true,
      })
    ).data;
    for (const [player, square] of [
      [a, 0],
      [b, 3],
      [a, 1],
      [b, 4],
      [a, 2],
    ] as const) {
      const response = await request('/api/chat/tictactoe', player, {
        roomId,
        action: 'move',
        gameId: state.game.id,
        round: 1,
        revision: state.revision,
        square,
      });
      assert.equal(response.status, 200);
      state = response.data;
    }
    assert.equal(state.game.result, 'X');
    const drawing = await request('/api/chat/drawing', a, {
      roomId,
      action: 'invite',
      category: 'all',
      difficulty: 'mixed',
    });
    assert.equal(drawing.status, 200);
    await request('/api/chat/drawing', b, {
      roomId,
      action: 'respond',
      invitationId: drawing.data.invitation.id,
      accept: true,
    });
    const response = await request('/api/chat/tictactoe', a, {
      roomId,
      action: 'rematch',
      gameId: state.game.id,
      round: 1,
    });
    assert.equal(response.status, 409);
    assert.match(response.data.error, /Draw & Guess/);
  } finally {
    await request('/api/chat/leave', a, { roomId });
  }
});

test('a suspended phone can resume a live drawing turn, but abandoned games still expire', async (t) => {
  const { a, b, roomId } = await pair();
  const realNow = Date.now();
  let clock = realNow;
  try {
    const invitation = await request('/api/chat/drawing', a, {
      roomId,
      action: 'invite',
      category: 'all',
      difficulty: 'easy',
    });
    await request('/api/chat/drawing', b, {
      roomId,
      action: 'respond',
      invitationId: invitation.data.invitation.id,
      accept: true,
    });
    const own = (await request('/api/chat/drawing?roomId=' + roomId, a)).data.game;
    await request('/api/chat/drawing', a, {
      roomId,
      action: 'choose',
      gameId: own.id,
      round: 1,
      choiceId: own.choices[0].id,
    });
    t.mock.method(Date, 'now', () => clock);
    clock = realNow + 35000;
    await new Promise((r) => setTimeout(r, 5500));
    const resumed = await request('/api/chat/drawing?roomId=' + roomId, b);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.game.phase, 'drawing');
    clock = realNow + 96000;
    await new Promise((r) => setTimeout(r, 5500));
    assert.equal((await request('/api/chat/drawing?roomId=' + roomId, b)).status, 404);
  } finally {
    t.mock.restoreAll();
    await request('/api/chat/leave', a, { roomId });
  }
});

test('final-round results survive a phone waking just after the drawing deadline', async (t) => {
  const { a, b, roomId } = await pair();
  try {
    const invitation = await request('/api/chat/drawing', a, {
      roomId,
      action: 'invite',
      category: 'animals',
      difficulty: 'easy',
    });
    await request('/api/chat/drawing', b, {
      roomId,
      action: 'respond',
      invitationId: invitation.data.invitation.id,
      accept: true,
    });
    for (let round = 1; round <= 6; round++) {
      const drawer = round % 2 ? a : b,
        guesser = round % 2 ? b : a;
      const g = (await request('/api/chat/drawing?roomId=' + roomId, drawer)).data.game;
      const selected = await request('/api/chat/drawing', drawer, {
        roomId,
        action: 'choose',
        gameId: g.id,
        round,
        choiceId: g.choices[0].id,
      });
      assert.equal(selected.status, 200);
      if (round < 6) {
        await request('/api/chat/drawing', guesser, {
          roomId,
          action: 'guess',
          gameId: g.id,
          round,
          text: selected.data.game.word,
        });
        await request('/api/chat/drawing', drawer, { roomId, action: 'next', gameId: g.id, round });
      }
    }
    const clock = Date.now() + 65000;
    t.mock.method(Date, 'now', () => clock);
    await new Promise((r) => setTimeout(r, 5500));
    const result = await request('/api/chat/drawing?roomId=' + roomId, a);
    assert.equal(result.status, 200);
    assert.equal(result.data.game.phase, 'finished');
    assert.ok(result.data.game.word);
    assert.ok(result.data.game.result);
  } finally {
    t.mock.restoreAll();
    await request('/api/chat/leave', a, { roomId });
  }
});

test('WebSocket state is viewer-specific and REST recovers drawings after socket loss', async () => {
  const { a, b, roomId } = await pair();
  const events: any[] = [];
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/chat', {
    headers: { Cookie: 'cm_session=' + b.token, Origin: base },
  });
  ws.on('error', () => {});
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
  try {
    await new Promise<void>((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'join_queue', interests: ['Drawing'] }));
    await waitFor(() => events.some((e) => e.type === 'matched'));
    const invite = await request('/api/chat/drawing', a, {
      roomId,
      action: 'invite',
      category: 'animals',
      difficulty: 'easy',
    });
    assert.equal(invite.status, 200);
    await request('/api/chat/drawing', b, {
      roomId,
      action: 'respond',
      invitationId: invite.data.invitation.id,
      accept: true,
    });
    const own = (await request('/api/chat/drawing?roomId=' + roomId, a)).data.game;
    assert.equal(own.choices.length, 3);
    await waitFor(() => events.some((e) => e.type === 'drawing_state' && e.state.game));
    assert.ok(
      events
        .filter((e) => e.type === 'drawing_state')
        .every((e) => !e.state.game || e.state.game.choices.length === 0),
    );
    const chosen = await request('/api/chat/drawing', a, {
      roomId,
      action: 'choose',
      gameId: own.id,
      round: 1,
      choiceId: own.choices[0].id,
    });
    assert.ok(chosen.data.game.word);
    const stroke = {
      roomId,
      action: 'stroke',
      gameId: own.id,
      round: 1,
      canvasVersion: 0,
      strokeId: 'live',
      offset: 0,
      color: '#292524',
      width: 5,
      eraser: false,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    };
    assert.equal((await request('/api/chat/drawing', a, stroke)).status, 200);
    await waitFor(() =>
      events.some((e) => e.type === 'drawing_state' && e.state.game?.strokes.length === 1),
    );
    assert.ok(
      events
        .filter((e) => e.type === 'drawing_state')
        .every((e) => !e.state.game || e.state.game.word === null),
    );
    ws.close();
    await new Promise<void>((r) => ws.once('close', () => r()));
    const recovered = await request('/api/chat/drawing?roomId=' + roomId, b);
    assert.equal(recovered.data.game.strokes[0].points.length, 2);
    assert.equal((await request('/api/chat/drawing', b, stroke)).status, 409);
    assert.equal(
      (
        await request('/api/chat/drawing', a, {
          roomId,
          action: 'clear',
          gameId: own.id,
          round: 1,
          canvasVersion: 0,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request('/api/chat/drawing?roomId=' + roomId, b)).data.game.strokes.length,
      0,
    );
  } finally {
    ws.terminate();
    await request('/api/chat/leave', a, { roomId });
  }
});
