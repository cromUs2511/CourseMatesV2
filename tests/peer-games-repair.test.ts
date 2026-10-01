import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { attachRuntime, issueSession } from '../runtime';
import { PeerChess } from '../chess';
import { PeerRockPaperScissors } from '../rps';
import { PeerTrivia } from '../trivia';
import { PeerWouldYouRather } from '../wouldYouRather';
import { PeerConnectFour } from '../connectFour';

const peers = [
  { id: 'a', handle: 'Alice' },
  { id: 'b', handle: 'Bob' },
];

function startGame(
  game: {
    act(actor: string, peers: { id: string; handle: string }[], action: never): void;
    snapshot(now?: number): { invitation: { id: string } | null };
  },
  invite: never,
  accept: (invitationId: string) => never,
) {
  game.act('a', peers, invite);
  const invitation = game.snapshot().invitation!;
  assert.ok(invitation, 'invitation should exist');
  game.act('b', peers, accept(invitation.id));
}

// ---------------------------------------------------------------- Chess ---

test('chess starts with all 32 pieces in the standard position', () => {
  const game = new PeerChess();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const board = game.snapshot().game!.board;
  let count = 0;
  for (const row of board) for (const square of row) if (square) count++;
  assert.equal(count, 32);
  // Rank 8 (black home rank) is board[0]; rank 1 (white home rank) is board[7].
  assert.deepEqual(board[0]![0], { type: 'rook', color: 'black' });
  assert.deepEqual(board[0]![1], { type: 'knight', color: 'black' });
  assert.deepEqual(board[0]![2], { type: 'bishop', color: 'black' });
  assert.deepEqual(board[0]![3], { type: 'queen', color: 'black' });
  assert.deepEqual(board[0]![4], { type: 'king', color: 'black' });
  assert.deepEqual(board[7]![4], { type: 'king', color: 'white' });
  assert.deepEqual(board[7]![3], { type: 'queen', color: 'white' });
  assert.deepEqual(board[6]![3], { type: 'pawn', color: 'white' });
  assert.deepEqual(board[1]![3], { type: 'pawn', color: 'black' });
  assert.equal(board[4]![4], null);
});

test('chess opening pawn moves work and illegal moves are rejected', () => {
  const game = new PeerChess();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const move = (actor: string, from: [number, number], to: [number, number], promotion?: 'queen') =>
    game.act(actor, peers, {
      action: 'move',
      gameId: id,
      round: 1,
      revision: 0,
      from,
      to,
      promotion,
    } as never);
  move('a', [6, 4], [4, 4]); // e2-e4
  const state = game.snapshot().game!;
  assert.equal(state.turn, 'black');
  assert.deepEqual(state.board[4]![4], { type: 'pawn', color: 'white' });
  assert.equal(state.board[6]![4], null);
  // Full FEN fidelity: placement, turn and castling rights survive the round-trip.
  assert.ok(state.fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq'));
  // Wrong turn.
  assert.throws(() => move('a', [4, 4], [3, 4]), /not your turn/);
  // Pawn cannot move backwards / onto own piece square illegally.
  move('b', [1, 4], [3, 4]); // e7-e5
  assert.throws(() => move('a', [4, 4], [3, 4]), /Invalid move/); // e4-e5 blocked
  // Out-of-board squares are rejected, not crashed on.
  assert.throws(() => move('a', [6, 0], [9, 9] as never), /board/);
});

test("chess detects checkmate via scholar's mate", () => {
  const game = new PeerChess();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const move = (actor: string, from: [number, number], to: [number, number]) =>
    game.act(actor, peers, {
      action: 'move',
      gameId: id,
      round: 1,
      revision: 0,
      from,
      to,
    } as never);
  move('a', [6, 4], [4, 4]); // e4
  move('b', [1, 4], [3, 4]); // e5
  move('a', [7, 3], [3, 7]); // Qh5
  move('b', [0, 1], [2, 2]); // Nc6
  move('a', [7, 5], [4, 2]); // Bc4
  move('b', [0, 6], [2, 5]); // Nf6
  move('a', [3, 7], [1, 5]); // Qxf7#
  const state = game.snapshot().game!;
  assert.deepEqual(state.result, { winnerId: 'a', reason: 'checkmate' });
});

test('chess castling works because FEN state is preserved', () => {
  const game = new PeerChess();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const move = (actor: string, from: [number, number], to: [number, number]) =>
    game.act(actor, peers, {
      action: 'move',
      gameId: id,
      round: 1,
      revision: 0,
      from,
      to,
    } as never);
  move('a', [6, 4], [4, 4]); // e4
  move('b', [1, 4], [3, 4]); // e5
  move('a', [7, 6], [5, 5]); // Nf3
  move('b', [0, 1], [2, 2]); // Nc6
  move('a', [7, 5], [4, 2]); // Bc4
  move('b', [0, 5], [3, 2]); // Bc5
  move('a', [7, 4], [7, 6]); // O-O
  const state = game.snapshot().game!;
  assert.deepEqual(state.board[7]![6], { type: 'king', color: 'white' });
  assert.deepEqual(state.board[7]![5], { type: 'rook', color: 'white' });
});

test('chess en passant capture works', () => {
  const game = new PeerChess();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const move = (actor: string, from: [number, number], to: [number, number]) =>
    game.act(actor, peers, {
      action: 'move',
      gameId: id,
      round: 1,
      revision: 0,
      from,
      to,
    } as never);
  move('a', [6, 4], [4, 4]); // e4
  move('b', [0, 1], [2, 2]); // Nc6 (waiting)
  move('a', [4, 4], [3, 4]); // e5
  move('b', [1, 3], [3, 3]); // d5
  move('a', [3, 4], [2, 3]); // exd6 e.p.
  const state = game.snapshot().game!;
  assert.deepEqual(state.board[2]![3], { type: 'pawn', color: 'white' });
  assert.equal(state.board[3]![3], null);
});

test('chess pawn promotion works with a mapped promotion piece', () => {
  const game = new PeerChess();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const move = (actor: string, from: [number, number], to: [number, number], promotion?: 'queen') =>
    game.act(actor, peers, {
      action: 'move',
      gameId: id,
      round: 1,
      revision: 0,
      from,
      to,
      promotion,
    } as never);
  move('a', [6, 1], [4, 1]); // b4
  move('b', [0, 6], [2, 5]); // Nf6
  move('a', [4, 1], [3, 1]); // b5
  move('b', [1, 2], [3, 2]); // c5
  move('a', [3, 1], [2, 2]); // bxc6 e.p.
  move('b', [1, 4], [2, 4]); // e6
  move('a', [2, 2], [1, 2]); // c7
  move('b', [1, 7], [2, 7]); // h6
  move('a', [1, 2], [0, 3], 'queen'); // cxd8=Q
  const state = game.snapshot().game!;
  assert.deepEqual(state.board[0]![3], { type: 'queen', color: 'white' });
});

// ------------------------------------------------------------- RPS ---

test('rps completes a best-of-three with next-round progression', () => {
  const game = new PeerRockPaperScissors();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const choose = (actor: string, choice: 'rock' | 'paper' | 'scissors', round: number) =>
    game.act(actor, peers, { action: 'choose', gameId: id, round, revision: 0, choice } as never);
  const next = (round: number) =>
    game.act('a', peers, { action: 'next', gameId: id, round, revision: 0 } as never);

  choose('a', 'rock', 1);
  choose('b', 'scissors', 1);
  let state = game.snapshot().game!;
  assert.equal(state.turn, 'revealing');
  assert.equal(state.scores['a'], 1);
  // Stuck-regression: the match must advance instead of freezing here.
  next(1);
  state = game.snapshot().game!;
  assert.equal(state.round, 2);
  assert.equal(state.turn, 'choosing');
  assert.deepEqual(state.choices, {});

  choose('a', 'rock', 2);
  choose('b', 'paper', 2);
  next(2);
  state = game.snapshot().game!;
  assert.equal(state.round, 3);

  choose('a', 'paper', 3);
  choose('b', 'rock', 3);
  state = game.snapshot().game!;
  assert.equal(state.turn, 'round-end');
  assert.equal(state.result!.winnerId, 'a');
});

test('rps rejects invalid choices and hides the opponent choice before reveal', () => {
  const game = new PeerRockPaperScissors();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  assert.throws(
    () =>
      game.act('a', peers, {
        action: 'choose',
        gameId: id,
        round: 1,
        revision: 0,
        choice: 'lizard',
      } as never),
    /rock, paper/,
  );
  game.act('a', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'rock',
  } as never);
  const hiddenForB = game.serializeFor('b');
  assert.deepEqual(hiddenForB.game!.choices, {});
  assert.equal(hiddenForB.game!.players.find((p) => p.id === 'a')!.choice, null);
  const visibleForA = game.serializeFor('a');
  assert.deepEqual(visibleForA.game!.choices, { a: 'rock' });
  game.act('b', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'paper',
  } as never);
  const revealed = game.serializeFor('b').game!;
  assert.deepEqual(revealed.choices, { a: 'rock', b: 'paper' });
});

// ---------------------------------------------------------- Trivia ---

test('trivia validates answers and advances through questions with next', () => {
  const game = new PeerTrivia();
  startGame(
    game,
    { action: 'invite', category: 'general' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const answer = (actor: string, answerIndex: number, round = 1) =>
    game.act(actor, peers, {
      action: 'answer',
      gameId: id,
      round,
      revision: 0,
      answerIndex,
    } as never);
  // Out-of-range indexes are rejected.
  assert.throws(() => answer('a', 99), /listed answers/);
  assert.throws(() => answer('a', -1), /listed answers/);

  const total = game.snapshot().game!.questions.length;
  for (let index = 0; index < total; index++) {
    const state = game.snapshot().game!;
    assert.equal(state.currentQuestionIndex, index);
    assert.equal(state.phase, 'answering');
    const correct = state.questions[index]!.correctIndex;
    answer('a', correct);
    // Duplicate answers are rejected.
    assert.throws(() => answer('a', correct), /already answered/);
    answer('b', (correct + 1) % 4);
    const revealed = game.snapshot().game!;
    assert.equal(revealed.phase, index === total - 1 ? 'game-end' : 'revealing');
    if (index < total - 1) {
      game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never);
      const advanced = game.snapshot().game!;
      assert.equal(advanced.currentQuestionIndex, index + 1);
      assert.equal(advanced.phase, 'answering');
      assert.deepEqual(advanced.answers, {});
    }
  }
  const final = game.snapshot().game!;
  assert.equal(final.phase, 'game-end');
  assert.equal(final.result!.winnerId, 'a');
  assert.equal(final.result!.finalScores['a'], total);
  // Skipping ahead is impossible once the match is over.
  assert.throws(
    () => game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never),
    /current question/,
  );
});

test('trivia keeps answers and the correct index private before reveal', () => {
  const game = new PeerTrivia();
  startGame(
    game,
    { action: 'invite', category: 'general' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const correct = game.snapshot().game!.questions[0]!.correctIndex;
  game.act('a', peers, {
    action: 'answer',
    gameId: id,
    round: 1,
    revision: 0,
    answerIndex: correct,
  } as never);
  const hidden = game.serializeFor('b').game!;
  assert.deepEqual(hidden.answers, {});
  assert.equal(hidden.questions[0]!.correctIndex, -1);
  game.act('b', peers, {
    action: 'answer',
    gameId: id,
    round: 1,
    revision: 0,
    answerIndex: (correct + 1) % 4,
  } as never);
  const revealed = game.serializeFor('b').game!;
  assert.ok(revealed.answers['a']);
  assert.equal(revealed.questions[0]!.correctIndex, correct);
});

// ------------------------------------------------------------- WYR ---

test('wyr keeps choices private until both players choose', () => {
  const game = new PeerWouldYouRather();
  startGame(
    game,
    { action: 'invite', category: 'Random' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  game.act('a', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'A',
  } as never);
  const hidden = game.serializeFor('b').game!;
  assert.deepEqual(hidden.choices, {});
  assert.deepEqual(game.serializeFor('a').game!.choices, { a: 'A' });
  game.act('b', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'B',
  } as never);
  const revealed = game.serializeFor('b').game!;
  assert.deepEqual(revealed.choices, { a: 'A', b: 'B' });
  assert.equal(revealed.phase, 'revealing');
  assert.equal(revealed.result!.sameChoice, false);
  game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never);
  const advanced = game.snapshot().game!;
  assert.equal(advanced.currentQuestionIndex, 1);
  assert.equal(advanced.phase, 'choosing');
});

// ---------------------------------------------------- Connect Four ---

test('connect four records the last move and detects a horizontal win', () => {
  const game = new PeerConnectFour();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  const drop = (actor: string, column: number) =>
    game.act(actor, peers, { action: 'move', gameId: id, round: 1, revision: 0, column } as never);
  drop('a', 0);
  assert.deepEqual(game.snapshot().game!.lastMove, { row: 5, col: 0 });
  drop('b', 0);
  drop('a', 1);
  drop('b', 1);
  drop('a', 2);
  drop('b', 2);
  // Wrong turn is rejected.
  assert.throws(() => drop('b', 3), /not your turn/);
  drop('a', 3);
  const state = game.snapshot().game!;
  assert.equal(state.result!.winnerId, 'a');
  assert.equal(state.result!.winningCells.length, 4);
  assert.deepEqual(state.lastMove, { row: 5, col: 3 });
  // Finished rounds reject further moves.
  assert.throws(() => drop('b', 4), /round is over/);
});

// -------------------------------------------------- Leave the game ---

test('leaving clears the match and records who left', () => {
  const game = new PeerRockPaperScissors();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  game.act('a', peers, { action: 'leave' } as never);
  const cleared = game.snapshot();
  assert.equal(cleared.game, null);
  assert.equal(cleared.invitation, null);
  assert.deepEqual(cleared.leftBy, { id: 'a', handle: 'Alice' });
  // Leaving with nothing active is a harmless no-op.
  game.act('b', peers, { action: 'leave' } as never);
  assert.equal(game.snapshot().game, null);
  // A fresh invite clears the notice.
  game.act('b', peers, { action: 'invite' } as never);
  assert.equal(game.snapshot().leftBy, null);
});

test('rps tracks draws and locked players, and rematch resets the scoreboard', () => {
  const game = new PeerRockPaperScissors();
  startGame(
    game,
    { action: 'invite' } as never,
    (invitationId) => ({ action: 'respond', invitationId, accept: true }) as never,
  );
  const id = game.snapshot().game!.id;
  game.act('a', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'rock',
  } as never);
  assert.deepEqual(game.snapshot().game!.locked, ['a']);
  game.act('b', peers, {
    action: 'choose',
    gameId: id,
    round: 1,
    revision: 0,
    choice: 'rock',
  } as never);
  let state = game.snapshot().game!;
  assert.equal(state.turn, 'revealing');
  assert.equal(state.draws, 1);
  assert.deepEqual(state.scores, { a: 0, b: 0 });
  game.act('a', peers, { action: 'next', gameId: id, round: 1, revision: 0 } as never);
  state = game.snapshot().game!;
  assert.deepEqual(state.locked, []);
  // Finish the match, then rematch resets everything.
  game.act('a', peers, {
    action: 'choose',
    gameId: id,
    round: 2,
    revision: 0,
    choice: 'rock',
  } as never);
  game.act('b', peers, {
    action: 'choose',
    gameId: id,
    round: 2,
    revision: 0,
    choice: 'scissors',
  } as never);
  game.act('a', peers, { action: 'next', gameId: id, round: 2, revision: 0 } as never);
  game.act('a', peers, {
    action: 'choose',
    gameId: id,
    round: 3,
    revision: 0,
    choice: 'rock',
  } as never);
  game.act('b', peers, {
    action: 'choose',
    gameId: id,
    round: 3,
    revision: 0,
    choice: 'scissors',
  } as never);
  state = game.snapshot().game!;
  assert.equal(state.turn, 'round-end');
  game.act('a', peers, { action: 'rematch', gameId: id, round: 3 } as never);
  game.act('b', peers, { action: 'rematch', gameId: id, round: 3 } as never);
  state = game.snapshot().game!;
  assert.deepEqual(state.scores, { a: 0, b: 0 });
  assert.equal(state.draws, 0);
  assert.deepEqual(state.locked, []);
  assert.equal(state.turn, 'choosing');
});

// --------------------------------------- Single active game (HTTP) ---

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
  return { a, b, roomId: result.data.roomId };
}

test('only one peer game can be active per room', async () => {
  const { a, b, roomId } = await pair();
  try {
    const chessInvite = await request('/api/chat/chess', a, { roomId, action: 'invite' });
    assert.equal(chessInvite.status, 200);
    // A second game cannot start while the chess invitation is pending.
    const blocked = await request('/api/chat/rps', b, { roomId, action: 'invite' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /Chess/);

    const accepted = await request('/api/chat/chess', b, {
      roomId,
      action: 'respond',
      invitationId: chessInvite.data.invitation.id,
      accept: true,
    });
    assert.equal(accepted.status, 200);
    // UNO challenges are blocked while a peer game is live.
    const unoBlocked = await request('/api/uno/challenge', a, { roomId });
    assert.equal(unoBlocked.status, 409);
    assert.match(unoBlocked.data.error, /Chess/);

    // Leaving the game clears the match and tells the peer who left.
    const left = await request('/api/chat/chess', b, { roomId, action: 'leave' });
    assert.equal(left.status, 200);
    assert.equal(left.data.game, null);
    assert.equal(left.data.leftBy.id, b.id);
    const peerView = await request('/api/chat/chess?roomId=' + roomId, a);
    assert.equal(peerView.data.game, null);
    assert.equal(peerView.data.leftBy.id, b.id);

    // Ending the game frees the slot: start over, then resign instead.
    const chessAgain = await request('/api/chat/chess', a, { roomId, action: 'invite' });
    assert.equal(chessAgain.status, 200);
    const acceptedAgain = await request('/api/chat/chess', b, {
      roomId,
      action: 'respond',
      invitationId: chessAgain.data.invitation.id,
      accept: true,
    });
    assert.equal(acceptedAgain.status, 200);
    assert.equal(acceptedAgain.data.leftBy, null);
    const gameId = acceptedAgain.data.game.id;
    const resigned = await request('/api/chat/chess', a, {
      roomId,
      action: 'resign',
      gameId,
      round: 1,
      revision: accepted.data.revision,
    });
    assert.equal(resigned.status, 200);
    const rpsInvite = await request('/api/chat/rps', b, { roomId, action: 'invite' });
    assert.equal(rpsInvite.status, 200);
    // And the UNO slot guard also sees the live RPS game.
    const unoBlockedAgain = await request('/api/uno/challenge', a, { roomId });
    assert.equal(unoBlockedAgain.status, 409);
    assert.match(unoBlockedAgain.data.error, /Rock Paper Scissors/);
  } finally {
    await request('/api/match/cancel', a, {});
  }
});
