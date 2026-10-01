import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import {
  UnoGame,
  buildUnoDeck,
  createUnoChallenge,
  joinArena,
  leaveArena,
  respondToChallenge,
  startBotGame,
  unoChallengeForSession,
  unoGameForSession,
  unoLeaveGame,
  unoLeaveRoom,
  unoReset,
  unoStateFor,
} from '../uno';
import { UNO_COLORS, type UnoCard, type UnoColor } from '../unoTypes';

beforeEach(() => unoReset());

const card = (id: string, color: UnoCard['color'], value: UnoCard['value']): UnoCard => ({
  id,
  color,
  value,
});

/** A fresh table with full control over both hands, the deck and the turn. */
function rigged(
  hands: [UnoCard[], UnoCard[]],
  options: { top?: UnoCard; activeColor?: UnoColor; turn?: 0 | 1; deck?: UnoCard[] } = {},
): UnoGame {
  const game = new UnoGame({ id: 'p0', handle: 'Alpha' }, { id: 'p1', handle: 'Bravo' }, 'arena');
  game.players[0].hand = [...hands[0]];
  game.players[1].hand = [...hands[1]];
  game.deck = options.deck ?? buildUnoDeck();
  game.discard = [options.top ?? card('top', 'red', '3')];
  game.activeColor = options.activeColor ?? 'red';
  game.turn = options.turn ?? 0;
  game.hasDrawn = [false, false];
  game.status = 'playing';
  game.winner = null;
  return game;
}

test('the deck is the standard 108 cards with unique ids', () => {
  const deck = buildUnoDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((entry) => entry.id)).size, 108);
  assert.equal(deck.filter((entry) => entry.value === 'wild').length, 4);
  assert.equal(deck.filter((entry) => entry.value === 'wild+4').length, 4);
  assert.equal(deck.filter((entry) => entry.color === 'red').length, 25);
});

test('a viewer never receives the opponent hand', () => {
  // Deck ids are UUIDs, so only hex-impossible markers are safe to assert on.
  const game = rigged([
    [card('own-hand-one', 'blue', '7')],
    [card('opp-hand-one', 'green', '2'), card('opp-hand-two', 'yellow', '9')],
  ]);
  const state = game.stateFor('p0');
  assert.ok(state);
  assert.equal(state.you.hand.length, 1);
  assert.equal(state.opponent.handCount, 2);
  assert.ok(!('hand' in state.opponent));
  const serialised = JSON.stringify(state);
  assert.ok(!serialised.includes('opp-hand-one'));
  assert.ok(!serialised.includes('opp-hand-two'));
  assert.equal(game.stateFor('stranger'), null);
});

test('moves are rejected out of turn and for cards you do not hold', () => {
  const game = rigged(
    [[card('a1', 'red', '7'), card('a3', 'green', '9')], [card('b1', 'green', '2')]],
    { turn: 0 },
  );
  assert.throws(() => game.play('p1', 'b1'), /not your turn/);
  assert.throws(() => game.play('p0', 'missing'), /not in your hand/);
  assert.throws(() => game.play('p0', 'a3'), /doesn't match/);
  game.play('p0', 'a1');
  assert.equal(game.turn, 1);
});

test('a wild card demands a legal colour and then changes the active colour', () => {
  const wild = card('w1', 'black', 'wild');
  const game = rigged([[wild, card('a2', 'blue', '4')], [card('b1', 'green', '2')]]);
  assert.throws(() => game.play('p0', 'w1', 'purple' as UnoColor), /colour/);
  game.play('p0', 'w1', 'green');
  assert.equal(game.activeColor, 'green');
  assert.equal(game.turn, 1);
});

test('in 1v1 a reverse acts as a skip so the same player continues', () => {
  const game = rigged([
    [card('a1', 'red', 'reverse'), card('a2', 'blue', '4')],
    [card('b1', 'blue', '5')],
  ]);
  game.play('p0', 'a1');
  assert.equal(game.turn, 0);
  assert.match(game.notice, /acts as Skip/);
});

test('+2 makes the opponent draw two and lose the turn', () => {
  const game = rigged([
    [card('a1', 'red', '+2'), card('a2', 'blue', '4')],
    [card('b1', 'blue', '5')],
  ]);
  const before = game.players[1].hand.length;
  game.play('p0', 'a1');
  assert.equal(game.players[1].hand.length, before + 2);
  assert.equal(game.turn, 0);
  assert.match(game.notice, /drew 2/);
});

test('you may draw once per turn, then you must play or pass', () => {
  const game = rigged([[card('a1', 'blue', '7')], [card('b1', 'blue', '5')]]);
  const deckSize = game.deck.length;
  game.draw('p0');
  assert.equal(game.deck.length, deckSize - 1);
  assert.equal(game.players[0].hand.length, 2);
  assert.throws(() => game.draw('p0'), /already drew/);
  assert.throws(() => game.pass('p1'), /not your turn/);
  game.pass('p0');
  assert.equal(game.turn, 1);
});

test('playing down to the last card calls UNO automatically', () => {
  const second = card('a2', 'red', '7');
  const game = rigged([[card('a1', 'red', '5'), second], [card('b1', 'blue', '9')]]);
  game.play('p0', second.id);
  assert.equal(game.players[0].hand.length, 1);
  assert.equal(game.players[0].calledUno, true);
  assert.equal(game.turn, 1);
  assert.match(game.notice, /UNO!/);
  assert.equal(game.stateFor('p1')?.opponent.calledUno, true, 'the other seat sees the call');
});

test('a lost UNO call still costs two cards', () => {
  const second = card('a2', 'red', '7');
  const game = rigged([[card('a1', 'red', '5'), second], [card('b1', 'blue', '9')]]);
  game.play('p0', second.id);
  // The call is automatic now, but the penalty stays as the safety net.
  game.players[0].calledUno = false;
  game.turn = 0;
  game.hasDrawn = [true, false];
  game.pass('p0');
  assert.equal(game.players[0].hand.length, 3);
  assert.match(game.notice, /forgot to call UNO/);
});

test('emptying your hand ends the game in your favour', () => {
  const last = card('a1', 'red', '5');
  const game = rigged([[last], [card('b1', 'blue', '9')]]);
  game.play('p0', last.id);
  assert.equal(game.status, 'over');
  assert.equal(game.winner, 0);
  const state = game.stateFor('p0');
  assert.equal(state?.winner, 'you');
  assert.equal(game.stateFor('p1')?.winner, 'opponent');
  assert.throws(() => game.draw('p1'), /already over/);
});

test('the arena pairs the next arrival and never mixes in a bystander', () => {
  assert.deepEqual(joinArena('s1', 'Alpha'), { status: 'waiting' });
  const joined = joinArena('s2', 'Bravo');
  assert.equal(joined.status, 'matched');
  const game = unoGameForSession('s1');
  assert.ok(game);
  assert.equal(unoGameForSession('s2')?.id, game.id);
  assert.equal(unoGameForSession('s3'), undefined);
  assert.equal(unoStateFor('s1').game?.you.handle, 'Alpha');
  assert.equal(unoStateFor('s1').game?.opponent.handle, 'Bravo');
  assert.equal(unoStateFor('s3').game, null);
});

test('rejoining the arena keeps your seat and cancelling frees it', () => {
  joinArena('s1', 'Alpha');
  assert.deepEqual(joinArena('s1', 'Alpha'), { status: 'waiting' });
  leaveArena('s1');
  assert.equal(unoStateFor('s1').queued, false);
  joinArena('s2', 'Bravo');
  assert.equal(unoStateFor('s2').queued, true);
});

test('a chat challenge only becomes a table when the challenged peer accepts', () => {
  const challenge = createUnoChallenge(
    { id: 's1', handle: 'Alpha' },
    { id: 's2', handle: 'Bravo' },
    'room-1',
  );
  assert.equal(unoChallengeForSession('s2')?.id, challenge.id);
  assert.equal(unoStateFor('s1').challenge?.direction, 'outgoing');
  assert.equal(unoStateFor('s2').challenge?.direction, 'incoming');
  assert.throws(() => respondToChallenge(challenge.id, 's3', true), /not for you/);
  assert.throws(() => respondToChallenge(challenge.id, 's1', true), /can accept/);
  const declined = respondToChallenge(challenge.id, 's2', false);
  assert.equal(declined.game, undefined);
  assert.equal(unoGameForSession('s1'), undefined);
});

test('accepting a challenge starts a room table both players can see', () => {
  const challenge = createUnoChallenge(
    { id: 's1', handle: 'Alpha' },
    { id: 's2', handle: 'Bravo' },
    'room-1',
  );
  const { game } = respondToChallenge(challenge.id, 's2', true);
  assert.ok(game);
  assert.equal(game.source, 'room');
  assert.equal(game.roomId, 'room-1');
  assert.equal(unoStateFor('s2').game?.gameId, game.id);
  assert.equal(unoStateFor('s1').game?.opponent.handle, 'Bravo');
});

test('you cannot open a second challenge or table while one exists', () => {
  createUnoChallenge({ id: 's1', handle: 'Alpha' }, { id: 's2', handle: 'Bravo' }, 'room-1');
  assert.throws(
    () => createUnoChallenge({ id: 's1', handle: 'Alpha' }, { id: 's3', handle: 'Cara' }, 'room-2'),
    /already a challenge/,
  );
  assert.throws(() => joinArena('s1', 'Alpha'), /challenge first/);
  assert.equal(unoStateFor('s1').queued, false, 'a pending challenge blocks the arena seat');
});

test('walking away forfeits the game for the leaver and hides it from them', () => {
  joinArena('s1', 'Alpha');
  const { gameId } = joinArena('s2', 'Bravo');
  assert.ok(gameId);
  const ended = unoLeaveGame('s1');
  assert.equal(ended?.winner, 1);
  assert.equal(unoStateFor('s1').game, null);
  assert.equal(unoStateFor('s2').game?.status, 'over');
  assert.equal(unoStateFor('s2').game?.winner, 'you');
});

test('leaving a chat room ends the room table but keeps an arena table', () => {
  const challenge = createUnoChallenge(
    { id: 's1', handle: 'Alpha' },
    { id: 's2', handle: 'Bravo' },
    'room-1',
  );
  respondToChallenge(challenge.id, 's2', true);
  const ended = unoLeaveRoom('s1', 'room-1');
  assert.equal(ended.length, 1);
  assert.equal(unoStateFor('s2').game?.status, 'over');
  assert.equal(unoLeaveRoom('s1', 'other-room').length, 0);
  assert.equal(unoLeaveRoom('s1').length, 0, 'no room id means no room game is touched');

  joinArena('s3', 'Cara');
  const arena = joinArena('s4', 'Dana');
  assert.equal(arena.status, 'matched');
  assert.equal(unoLeaveRoom('s3', 'room-1').length, 0, 'a room leave never drops an arena table');
  assert.equal(unoStateFor('s3').game?.status, 'playing');
});

test('colours are one of the four standard UNO colours', () => {
  assert.deepEqual([...UNO_COLORS].sort(), ['blue', 'green', 'red', 'yellow']);
  for (const colour of UNO_COLORS) assert.ok(['red', 'blue', 'green', 'yellow'].includes(colour));
});

test('a chat table never awards a win for leaving and finished games need both rematch votes', () => {
  const challenge = createUnoChallenge({ id: 's1', handle: 'Alpha' }, { id: 's2', handle: 'Bravo' }, 'room');
  const game = respondToChallenge(challenge.id, 's2', true).game!;
  game.turn = 0;
  game.activeColor = 'red';
  game.discard = [card('top', 'red', '3')];
  game.players[0].hand = [card('last', 'red', '7')];
  game.play('s1', 'last');
  assert.equal(game.stateFor('s1')!.winnerHandle, game.stateFor('s2')!.winnerHandle);
  assert.equal(game.stateFor('s2')!.winner, 'opponent');
  assert.deepEqual(game.stateFor('s2')!.playable, []);
  assert.throws(() => game.draw('s2'), /already over/);
  game.rematch('s2', 1);
  game.rematch('s2', 1);
  assert.equal(game.status, 'over');
  game.rematch('s1', 1);
  assert.equal(game.status, 'playing');
  assert.equal(game.round, 2);
  assert.ok(game.players.every((player) => player.hand.length >= 7));
  game.forfeit('s1');
  assert.equal(game.winner, null);
  assert.throws(() => game.rematch('s2', 2), /Finish the match/);
});

test('a four player table fills with the earliest waiting seats and never mixes sizes', () => {
  assert.deepEqual(joinArena('s1', 'Alpha', 4), { status: 'waiting' });
  joinArena('s2', 'Bravo', 4);
  joinArena('s3', 'Cara', 4);
  // A classic 1v1 seat waits in its own queue.
  assert.deepEqual(joinArena('s4', 'Dana', 2), { status: 'waiting' });
  assert.equal(unoStateFor('s4').queued, true);

  const matched = joinArena('s5', 'Eli', 4);
  assert.equal(matched.status, 'matched');
  const game = unoGameForSession('s5');
  assert.ok(game);
  assert.equal(game.size, 4);
  assert.deepEqual(
    game.players.map((player) => player.handle),
    ['Alpha', 'Bravo', 'Cara', 'Eli'],
  );
  assert.equal(unoGameForSession('s4'), undefined, 'the 1v1 seat stayed queued');
  assert.equal(unoStateFor('s1').game?.opponents.length, 3);
  assert.equal(unoStateFor('s1').game?.size, 4);
});

test('a four player viewer receives hand counts only, never another seat hand', () => {
  const game = new UnoGame(
    { id: 'p0', handle: 'Alpha' },
    { id: 'p1', handle: 'Bravo' },
    'arena',
    undefined,
    [
      { id: 'p2', handle: 'Cara' },
      { id: 'p3', handle: 'Dana' },
    ],
  );
  const hands = [
    [card('own-hand-card', 'red', '7')],
    [card('rival-one', 'blue', '2')],
    [card('rival-two', 'green', '9')],
    [card('rival-three', 'yellow', '1')],
  ];
  game.players.forEach((player, index) => {
    player.hand = [...hands[index]!];
  });
  const state = game.stateFor('p0');
  assert.ok(state);
  assert.equal(state.size, 4);
  assert.equal(state.opponents.length, 3);
  assert.equal(state.opponent.handCount, 1, 'the closest rival stays available for 1v1 clients');
  const serialised = JSON.stringify(state);
  for (const id of ['rival-one', 'rival-two', 'rival-three']) assert.ok(!serialised.includes(id));
  assert.equal(game.stateFor('stranger'), null);
});

test('bots fill every free seat and only move while you are not at the table', () => {
  const game = startBotGame('s1', 'Alpha', 4);
  assert.equal(game.size, 4);
  assert.equal(
    game.players.filter((player) => player.bot).length,
    3,
    'three seats are played by the server',
  );

  const first = unoStateFor('s1').game;
  assert.ok(first);
  assert.equal(first.size, 4);
  assert.equal(first.opponents.length, 3);
  assert.ok(first.opponents.every((opponent) => opponent.bot));
  assert.equal(first.turn, 'you', 'the only human always gets the table back');
  assert.equal(first.status, 'playing');

  game.draw('s1');
  game.pass('s1');
  const after = unoStateFor('s1').game;
  assert.ok(after);
  assert.equal(after.turn === 'you' || after.status === 'over', true, 'the bots played through');
  assert.ok(after.opponents[0]!.bot);
  assert.ok(!('hand' in after.opponents[0]!));
});

test('walking away from a bot table finishes it and hides it from you', () => {
  startBotGame('s7', 'Gina', 2);
  const ended = unoLeaveGame('s7');
  assert.ok(ended);
  assert.equal(ended.status, 'over');
  assert.equal(unoStateFor('s7').game, null);
  assert.equal(unoStateFor('s7').queued, false);
});
