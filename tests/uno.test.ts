import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import {
  UnoGame,
  buildUnoDeck,
  createUnoChallenge,
  joinArena,
  leaveArena,
  respondToChallenge,
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

test('forgetting the UNO call at one card costs two cards', () => {
  const second = card('a2', 'red', '7');
  const game = rigged([[card('a1', 'red', '5'), second], [card('b1', 'blue', '9')]]);
  game.play('p0', second.id);
  assert.equal(game.players[0].hand.length, 3);
  assert.match(game.notice, /forgot to call UNO/);
});

test('calling UNO first protects the last card', () => {
  const second = card('a2', 'red', '7');
  const game = rigged([[card('a1', 'red', '5'), second], [card('b1', 'blue', '9')]]);
  game.callUno('p0');
  game.play('p0', second.id);
  assert.equal(game.players[0].hand.length, 1);
  assert.equal(game.players[0].calledUno, true);
  assert.equal(game.turn, 1);
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
