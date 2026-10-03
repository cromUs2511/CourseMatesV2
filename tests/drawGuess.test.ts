import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerDrawGuess, matchesDrawAnswer } from '../drawGuess';
import { DRAW_PROMPTS } from '../drawGuessPrompts';
import { DRAW_CATEGORIES, type DrawGuessAction } from '../src/data/drawGuess';

const peers = [
  { id: 'a', handle: 'Alpha' },
  { id: 'b', handle: 'Bravo' },
];
const now = 100000;
test('guess matching accepts curated synonyms and normalized text without substring matches', () => {
  assert.equal(matchesDrawAnswer('phone', '  CELL PHONE '), true);
  assert.equal(matchesDrawAnswer('hot dog', 'HOT-DOG'), true);
  assert.equal(matchesDrawAnswer('cat', 'cat in a hat'), false);
  assert.equal(matchesDrawAnswer('cat', 'c'), false);
  assert.equal(matchesDrawAnswer('phone', 'telephone'), true);
});
function start(category = 'all', difficulty = 'mixed') {
  const table = new PeerDrawGuess();
  table.act('a', peers, { action: 'invite', category, difficulty } as DrawGuessAction, now);
  table.act(
    'b',
    peers,
    { action: 'respond', invitationId: table.snapshot(now).invitation!.id, accept: true },
    now,
  );
  return table;
}
function choose(table: PeerDrawGuess, time = now) {
  const g = table.snapshot(time).game!;
  table.act(
    g.drawerId,
    peers,
    {
      action: 'choose',
      gameId: g.id,
      round: g.round,
      choiceId: table.serializeFor(g.drawerId, time).game!.choices[0]!.id,
    },
    time,
  );
  return table.serializeFor(g.drawerId, time).game!;
}
test('prompt bank supplies 1000 unique drawable ideas and all filter combinations', () => {
  assert.ok(DRAW_PROMPTS.length >= 1000);
  assert.equal(new Set(DRAW_PROMPTS.map((p) => p.id)).size, DRAW_PROMPTS.length);
  assert.equal(new Set(DRAW_PROMPTS.map((p) => p.word.toLowerCase())).size, DRAW_PROMPTS.length);
  for (const category of Object.keys(DRAW_CATEGORIES).filter((c) => c !== 'all')) {
    assert.ok(DRAW_PROMPTS.filter((p) => p.category === category).length >= 60);
    for (const difficulty of ['easy', 'medium', 'hard']) {
      assert.ok(
        DRAW_PROMPTS.filter((p) => p.category === category && p.difficulty === difficulty).length >=
          12,
      );
      const table = start(category, difficulty);
      const choices = table.serializeFor('a', now).game!.choices;
      assert.equal(choices.length, 3);
      assert.ok(choices.every((c) => c.category === category && c.difficulty === difficulty));
    }
  }
});
test('secret choices and answer remain private until the server reveals them', () => {
  const table = start();
  assert.equal(table.serializeFor('b', now).game!.choices.length, 0);
  const game = choose(table);
  assert.ok(game.word);
  assert.equal(table.serializeFor('b', now).game!.word, null);
  assert.equal(table.serializeFor('b', now).game!.choices.length, 0);
  assert.throws(
    () =>
      table.act('a', peers, { action: 'guess', gameId: game.id, round: 1, text: game.word! }, now),
    /guesser/,
  );
  table.act(
    'b',
    peers,
    { action: 'guess', gameId: game.id, round: 1, text: `  ${game.word!.toUpperCase()}  ` },
    now + 1000,
  );
  const revealed = table.serializeFor('b', now + 1000).game!;
  assert.equal(revealed.word, game.word);
  assert.equal(revealed.phase, 'reveal');
  assert.deepEqual(revealed.scores, { a: 100, b: 159 });
  assert.throws(
    () =>
      table.act(
        'b',
        peers,
        { action: 'guess', gameId: game.id, round: 1, text: game.word! },
        now + 2000,
      ),
    /drawing/,
  );
  assert.deepEqual(table.snapshot(now + 2000).game!.scores, { a: 100, b: 159 });
});
test('invitations reject outsiders, invalid filters, self acceptance and expiry', () => {
  const t = new PeerDrawGuess();
  assert.throws(
    () => t.act('x', peers, { action: 'invite', category: 'all', difficulty: 'mixed' }, now),
    /participants/,
  );
  assert.throws(() => start('invalid'), /category/);
  assert.throws(() => start('all', 'invalid'), /difficulty/);
  t.act('a', peers, { action: 'invite', category: 'all', difficulty: 'mixed' }, now);
  const inv = t.snapshot(now).invitation!;
  assert.throws(
    () => t.act('a', peers, { action: 'respond', invitationId: inv.id, accept: true }, now),
    /peer/,
  );
  assert.throws(
    () =>
      t.act('b', peers, { action: 'respond', invitationId: inv.id, accept: true }, inv.expiresAt),
    /available/,
  );
});
test('canvas validates roles, finite points, stale epochs, ordered batches, clear and undo', () => {
  const t = start();
  const g = choose(t);
  const stroke: Extract<DrawGuessAction, { action: 'stroke' }> = {
    action: 'stroke',
    gameId: g.id,
    round: 1,
    canvasVersion: g.canvasVersion,
    strokeId: 's1',
    offset: 0,
    color: '#292524',
    width: 5,
    eraser: false,
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
    ],
  };
  assert.throws(() => t.act('b', peers, stroke, now), /drawer/);
  assert.throws(() => t.act('a', peers, { ...stroke, points: [{ x: NaN, y: 0 }] }, now), /points/);
  assert.throws(() => t.act('a', peers, { ...stroke, points: [{ x: 2, y: 0 }] }, now), /points/);
  assert.throws(
    () => t.act('a', peers, { ...stroke, points: Array(65).fill({ x: 0, y: 0 }) }, now),
    /points/,
  );
  t.act('a', peers, stroke, now);
  t.act('a', peers, stroke, now); // exact retry is idempotent
  assert.equal(t.snapshot(now).game!.strokes[0]!.points.length, 2);
  t.act('a', peers, { ...stroke, offset: 2, points: [{ x: 0.5, y: 0.5 }] }, now);
  assert.equal(t.serializeFor('b', now).game!.strokes[0]!.points.length, 3);
  assert.throws(() => t.act('a', peers, { ...stroke, offset: 5 }, now), /order/);
  t.act('a', peers, { action: 'undo', gameId: g.id, round: 1, canvasVersion: 0 }, now);
  assert.equal(t.snapshot(now).game!.strokes.length, 0);
  assert.throws(() => t.act('a', peers, stroke, now), /canvas/);
  const version = t.snapshot(now).game!.canvasVersion;
  t.act('a', peers, { ...stroke, canvasVersion: version, strokeId: 's2' }, now);
  t.act('a', peers, { action: 'clear', gameId: g.id, round: 1, canvasVersion: version }, now);
  assert.equal(t.snapshot(now).game!.strokes.length, 0);
  assert.throws(() => t.act('a', peers, { ...stroke, canvasVersion: version }, now), /canvas/);
});
test('deadlines auto choose and reveal even after both browsers sleep', () => {
  const t = start();
  assert.equal(t.snapshot(now + 20000).game!.phase, 'drawing');
  assert.equal(t.snapshot(now + 80000).game!.phase, 'reveal');
  assert.ok(t.serializeFor('b', now + 80000).game!.word);
  assert.deepEqual(t.snapshot(now + 80000).game!.scores, { a: 0, b: 0 });
});
test('six alternating turns avoid repeated offers, reject stale advances, and rematch mutually', () => {
  const t = start();
  const offered = new Set<string>();
  for (let round = 1; round <= 6; round++) {
    const g = t.snapshot(now).game!;
    const drawer = round % 2 ? 'a' : 'b';
    assert.equal(g.drawerId, drawer);
    for (const p of t.serializeFor(drawer, now).game!.choices) {
      assert.ok(!offered.has(p.id));
      offered.add(p.id);
    }
    const chosen = choose(t);
    t.act(
      drawer === 'a' ? 'b' : 'a',
      peers,
      { action: 'guess', gameId: g.id, round, text: chosen.word! },
      now + 1000,
    );
    if (round < 6) {
      t.act('a', peers, { action: 'next', gameId: g.id, round }, now + 1000);
      assert.throws(
        () => t.act('b', peers, { action: 'next', gameId: g.id, round }, now + 1000),
        /round/,
      );
    }
  }
  const g = t.snapshot(now + 1000).game!;
  assert.equal(g.phase, 'finished');
  assert.ok(g.result);
  t.act('a', peers, { action: 'rematch', gameId: g.id, round: 6 }, now + 1000);
  t.act('a', peers, { action: 'rematch', gameId: g.id, round: 6 }, now + 1000);
  assert.equal(t.snapshot(now + 1000).game!.phase, 'finished');
  t.act('b', peers, { action: 'rematch', gameId: g.id, round: 6 }, now + 1000);
  const fresh = t.snapshot(now + 1000).game!;
  assert.equal(fresh.drawerId, 'b');
  assert.equal(fresh.round, 1);
  assert.notEqual(fresh.id, g.id);
  assert.deepEqual(fresh.scores, { a: 0, b: 0 });
  t.act('a', peers, { action: 'leave' }, now + 1000);
  assert.equal(t.snapshot(now + 1000).game, null);
  assert.equal(t.snapshot(now + 1000).leftBy!.id, 'a');
});
