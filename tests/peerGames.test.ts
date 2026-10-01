import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerTicTacToe } from '../ticTacToe';

const peers = [{ id: 'a', handle: 'Alpha' }, { id: 'b', handle: 'Bravo' }];
const start = () => {
  const table = new PeerTicTacToe();
  table.act('a', peers, { action: 'invite' });
  table.act('b', peers, { action: 'respond', invitationId: table.snapshot().invitation!.id, accept: true });
  return table;
};
test('Tic Tac Toe rejects outsiders, self-acceptance, stale invitations and expired invitations', () => {
  const table = new PeerTicTacToe();
  assert.throws(() => table.act('outsider', peers, { action: 'invite' }), /participants/);
  table.act('a', peers, { action: 'invite' });
  const invitation = table.snapshot().invitation!;
  assert.throws(() => table.act('a', peers, { action: 'respond', invitationId: invitation.id, accept: true }), /Only your peer/);
  assert.throws(() => table.act('b', peers, { action: 'respond', invitationId: 'stale', accept: true }), /no longer/);
  table.snapshot(invitation.expiresAt);
  assert.throws(() => table.act('b', peers, { action: 'respond', invitationId: invitation.id, accept: true }), /no longer/);
});
test('Tic Tac Toe validates turns, occupied squares, revisions and finished rounds', () => {
  const table = start();
  const move = (actor: string, square: number) => {
    const state = table.snapshot();
    table.act(actor, peers, { action: 'move', gameId: state.game!.id, round: state.game!.round, revision: state.revision, square });
  };
  assert.throws(() => move('b', 0), /not your turn/);
  assert.throws(() => move('a', 9), /empty square/);
  assert.throws(() => move('a', 0.1), /empty square/);
  const stale = table.snapshot();
  move('a', 0);
  assert.throws(() => table.act('b', peers, { action: 'move', gameId: stale.game!.id, round: 1, revision: stale.revision, square: 1 }), /board changed/);
  assert.throws(() => move('b', 0), /empty square/);
  move('b', 3); move('a', 1); move('b', 4); move('a', 2);
  assert.equal(table.snapshot().game!.result, 'X');
  assert.deepEqual(table.snapshot().game!.winningLine, [0, 1, 2]);
  assert.throws(() => move('b', 6), /round is over/);
  const gameId = table.snapshot().game!.id;
  table.act('a', peers, { action: 'rematch', gameId, round: 1 });
  table.act('a', peers, { action: 'rematch', gameId, round: 1 });
  assert.equal(table.snapshot().game!.round, 1);
  table.act('b', peers, { action: 'rematch', gameId, round: 1 });
  assert.equal(table.snapshot().game!.round, 2);
  assert.equal(table.snapshot().game!.turn, 'O');
  assert.throws(() => table.act('a', peers, { action: 'rematch', gameId, round: 1 }), /no longer/);
  for (const [actor, square] of [['b', 0], ['a', 1], ['b', 2], ['a', 4], ['b', 3], ['a', 5], ['b', 7], ['a', 6], ['b', 8]] as const) move(actor, square);
  assert.equal(table.snapshot().game!.result, 'draw');
});
