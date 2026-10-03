import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { attachRuntime, issueSession } from '../runtime';
import { createUnoChallenge, respondToChallenge, unoLeaveGame, unoReset } from '../uno';
import { PeerTicTacToe } from '../ticTacToe';
import { PeerRockPaperScissors } from '../rps';
import { PeerConnectFour } from '../connectFour';
import { PeerChess } from '../chess';
import { PeerTrivia } from '../trivia';
import { PeerWouldYouRather } from '../wouldYouRather';
import { PeerDrawGuess } from '../drawGuess';

const peers = [
  { id: 'a', handle: 'Alice' },
  { id: 'b', handle: 'Bob' },
];

function inviteAndAccept(
  game: {
    act(actor: string, peers: { id: string; handle: string }[], action: never): void;
    snapshot(now?: number): { invitation: { id: string } | null };
  },
  invite: never,
) {
  game.act('a', peers, invite);
  const invitation = game.snapshot().invitation!;
  assert.ok(invitation, 'invitation should exist');
  game.act('b', peers, { action: 'respond', invitationId: invitation.id, accept: true } as never);
}

// ------------------------------------------------- Tic Tac Toe ---

test('a finished tic-tac-toe round auto-terminates so a new invite works', () => {
  const game = new PeerTicTacToe();
  inviteAndAccept(game, { action: 'invite' } as never);
  const id = game.snapshot().game!.id;
  const move = (actor: string, square: number) =>
    game.act(actor, peers, {
      action: 'move',
      gameId: id,
      round: 1,
      revision: game.snapshot().revision,
      square,
    } as never);
  move('a', 0);
  move('b', 3);
  move('a', 1);
  move('b', 4);
  move('a', 2);
  assert.equal(game.snapshot().game!.result, 'X');
  // No manual leave needed: a fresh invite replaces the finished round.
  game.act('a', peers, { action: 'invite' } as never);
  assert.ok(game.snapshot().invitation, 'new invitation should exist');
  assert.equal(game.snapshot().game, null);
});

test('a live tic-tac-toe match still blocks a new invite', () => {
  const game = new PeerTicTacToe();
  inviteAndAccept(game, { action: 'invite' } as never);
  assert.throws(() => game.act('a', peers, { action: 'invite' } as never), /current game/);
});

// ------------------------------------------------- Connect Four ---

test('a finished connect-four round auto-terminates so a new invite works', () => {
  const game = new PeerConnectFour();
  inviteAndAccept(game, { action: 'invite' } as never);
  const id = game.snapshot().game!.id;
  const drop = (actor: string, column: number) =>
    game.act(actor, peers, { action: 'move', gameId: id, round: 1, revision: 0, column } as never);
  drop('a', 0);
  drop('b', 0);
  drop('a', 1);
  drop('b', 1);
  drop('a', 2);
  drop('b', 2);
  drop('a', 3);
  assert.ok(game.snapshot().game!.result, 'there should be a winner');
  game.act('b', peers, { action: 'invite' } as never);
  assert.ok(game.snapshot().invitation, 'new invitation should exist');
  assert.equal(game.snapshot().game, null);
});

// ------------------------------------------------- Chess ---

test('a resigned chess round auto-terminates so a new invite works', () => {
  const game = new PeerChess();
  inviteAndAccept(game, { action: 'invite' } as never);
  const id = game.snapshot().game!.id;
  game.act('a', peers, { action: 'resign', gameId: id, round: 1, revision: 0 } as never);
  assert.ok(game.snapshot().game!.result, 'resignation should end the round');
  game.act('a', peers, { action: 'invite' } as never);
  assert.ok(game.snapshot().invitation, 'new invitation should exist');
  assert.equal(game.snapshot().game, null);
});

// ------------------------------------------------- RPS ---

test('rps auto-terminates only once the match ends, not on a round reveal', () => {
  const game = new PeerRockPaperScissors();
  inviteAndAccept(game, { action: 'invite' } as never);
  const id = game.snapshot().game!.id;
  const choose = (actor: string, choice: 'rock' | 'paper' | 'scissors', round: number) =>
    game.act(actor, peers, { action: 'choose', gameId: id, round, revision: 0, choice } as never);
  choose('a', 'rock', 1);
  choose('b', 'scissors', 1);
  assert.equal(game.snapshot().game!.turn, 'revealing');
  // Mid-match reveal: the match is still live, so a new invite is rejected.
  assert.throws(() => game.act('a', peers, { action: 'invite' } as never), /current game/);
  game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never);
  choose('a', 'rock', 2);
  choose('b', 'paper', 2);
  game.act('a', peers, { action: 'next', gameId: id, round: 2, revision: 0 } as never);
  choose('a', 'paper', 3);
  choose('b', 'rock', 3);
  assert.equal(game.snapshot().game!.turn, 'round-end');
  game.act('a', peers, { action: 'invite' } as never);
  assert.ok(game.snapshot().invitation, 'new invitation should exist after match end');
  assert.equal(game.snapshot().game, null);
});

// ------------------------------------------------- Trivia ---

test('a finished trivia match auto-terminates so a new invite works', () => {
  const game = new PeerTrivia();
  inviteAndAccept(game, { action: 'invite', category: 'general' } as never);
  const id = game.snapshot().game!.id;
  const total = game.snapshot().game!.questions.length;
  for (let index = 0; index < total; index++) {
    const correct = game.snapshot().game!.questions[index]!.correctIndex;
    game.act('a', peers, {
      action: 'answer',
      gameId: id,
      round: 1,
      revision: 0,
      answerIndex: correct,
    } as never);
    game.act('b', peers, {
      action: 'answer',
      gameId: id,
      round: 1,
      revision: 0,
      answerIndex: (correct + 1) % 4,
    } as never);
    if (index < total - 1)
      game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never);
  }
  assert.equal(game.snapshot().game!.phase, 'game-end');
  game.act('b', peers, { action: 'invite', category: 'general' } as never);
  assert.ok(game.snapshot().invitation, 'new invitation should exist after match end');
  assert.equal(game.snapshot().game, null);
});

// ------------------------------------------------- Would You Rather ---

test('wyr auto-terminates only once the match ends, not on a question reveal', () => {
  const game = new PeerWouldYouRather();
  inviteAndAccept(game, { action: 'invite', category: 'Random' } as never);
  const id = game.snapshot().game!.id;
  game.act('a', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'A',
  } as never);
  game.act('b', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'B',
  } as never);
  assert.equal(game.snapshot().game!.phase, 'revealing');
  // Mid-match reveal: the match is still live, so a new invite is rejected.
  assert.throws(
    () => game.act('a', peers, { action: 'invite', category: 'Random' } as never),
    /current game/,
  );
  const total = game.snapshot().game!.questions.length;
  for (let index = 0; index < total; index++) {
    const state = game.snapshot().game!;
    if (state.phase === 'choosing') {
      game.act('a', peers, {
        action: 'choose',
        gameId: id,
        round: 1,
        revision: 0,
        choice: 'A',
      } as never);
      game.act('b', peers, {
        action: 'choose',
        gameId: id,
        round: 1,
        revision: 0,
        choice: 'A',
      } as never);
    }
    if (index < total - 1)
      game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never);
    else game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never);
  }
  assert.equal(game.snapshot().game!.phase, 'round-end');
  game.act('a', peers, { action: 'invite', category: 'Random' } as never);
  assert.ok(game.snapshot().invitation, 'new invitation should exist after match end');
  assert.equal(game.snapshot().game, null);
});

// ------------------------------------------------- Draw & Guess ---

test('a finished draw-and-guess match auto-terminates so a new invite works', () => {
  const game = new PeerDrawGuess();
  inviteAndAccept(game, { action: 'invite', category: 'all', difficulty: 'mixed' } as never);
  // The guess rate limiter needs >1s between guesses; snapshots stay on real time
  // so turn deadlines never interfere with the scripted playthrough.
  let guessNow = Date.now();
  for (let round = 1; round <= 6; round++) {
    const current = game.snapshot().game!;
    assert.equal(current.round, round);
    if (current.phase === 'choosing') {
      const choice = game.serializeFor(current.drawerId).game!.choices[0]!;
      game.act(current.drawerId, peers, {
        action: 'choose',
        gameId: current.id,
        round,
        choiceId: choice.id,
      } as never);
    }
    const drawer = game.snapshot().game!.drawerId;
    const guesser = drawer === 'a' ? 'b' : 'a';
    const word = game.serializeFor(drawer).game!.word!;
    const playing = game.snapshot().game!;
    guessNow += 1100;
    game.act(
      guesser,
      peers,
      {
        action: 'guess',
        gameId: playing.id,
        round,
        text: word,
      } as never,
      guessNow,
    );
    const revealed = game.snapshot().game!;
    if (revealed.phase === 'reveal')
      game.act('a', peers, { action: 'next', gameId: revealed.id, round } as never);
  }
  const finished = game.snapshot().game!;
  assert.equal(finished.phase, 'finished');
  assert.ok(finished.result, 'a finished match has a result');
  game.act('a', peers, { action: 'invite', category: 'all', difficulty: 'mixed' } as never);
  assert.ok(game.snapshot().invitation, 'new invitation should exist after match end');
  assert.equal(game.snapshot().game, null);
});

test('a live draw-and-guess match still blocks a new invite', () => {
  const game = new PeerDrawGuess();
  inviteAndAccept(game, { action: 'invite', category: 'all', difficulty: 'mixed' } as never);
  assert.throws(
    () => game.act('a', peers, { action: 'invite', category: 'all', difficulty: 'mixed' } as never),
    /current game/,
  );
});

// --------------------------------------- HTTP: finished games free the slot ---

const app = express();
app.use(express.json());
const server = http.createServer(app);
const stop = attachRuntime(app, server);
let base: string;
before(async () => {
  unoReset();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
after(async () => {
  stop();
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const identity = () => issueSession('test@gmail.com', {}, false);
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
  return { a, b, roomId: result.data.roomId as string };
}

test('a finished UNO table no longer blocks peer games', async () => {
  unoReset();
  const { a, b, roomId } = await pair();
  try {
    // Start a room UNO table directly (same-process UNO store as the runtime).
    const sessionA = a.id;
    const sessionB = b.id;
    const challenge = createUnoChallenge(
      { id: sessionA, handle: 'Alpha' },
      { id: sessionB, handle: 'Bravo' },
      roomId,
    );
    respondToChallenge(challenge.id, sessionB, true);
    // One player walks away: the table is over, and the slot auto-terminates.
    unoLeaveGame(sessionA);
    const rpsInvite = await request('/api/chat/rps', b, { roomId, action: 'invite' });
    assert.equal(rpsInvite.status, 200, 'a finished UNO table must not block RPS');
  } finally {
    await request('/api/match/cancel', a, {});
  }
});

test('a finished tic-tac-toe round allows a fresh invite over HTTP', async () => {
  unoReset();
  const { a, b, roomId } = await pair();
  try {
    const invite = await request('/api/chat/tictactoe', a, { roomId, action: 'invite' });
    assert.equal(invite.status, 200);
    const accepted = await request('/api/chat/tictactoe', b, {
      roomId,
      action: 'respond',
      invitationId: invite.data.invitation.id,
      accept: true,
    });
    assert.equal(accepted.status, 200);
    const gameId = accepted.data.game.id as string;
    const move = (session: ReturnType<typeof identity>, square: number, revision: number) =>
      request('/api/chat/tictactoe', session, {
        roomId,
        action: 'move',
        gameId,
        round: 1,
        revision,
        square,
      });
    let revision = accepted.data.revision as number;
    for (const [session, square] of [
      [a, 0],
      [b, 3],
      [a, 1],
      [b, 4],
      [a, 2],
    ] as const) {
      const played = await move(session, square, revision);
      assert.equal(played.status, 200);
      revision = played.data.revision as number;
    }
    assert.ok(accepted.data, 'round completed');
    // A fresh invite auto-terminates the finished round: no manual leave needed.
    const fresh = await request('/api/chat/tictactoe', a, { roomId, action: 'invite' });
    assert.equal(fresh.status, 200);
    assert.ok(fresh.data.invitation, 'a new invitation should exist');
  } finally {
    await request('/api/match/cancel', a, {});
  }
});
