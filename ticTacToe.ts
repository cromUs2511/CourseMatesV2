import crypto from 'node:crypto';
import type { TicTacToeAction, TicTacToeState } from './src/data/peerGames';

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Owned by the chat room; no separate queue, tokens, timers, or retained history. */
export class PeerTicTacToe {
  private state: TicTacToeState = { revision: 0, invitation: null, game: null };

  snapshot(now = Date.now()): TicTacToeState {
    if (this.state.invitation && this.state.invitation.expiresAt <= now) {
      this.state.invitation = null;
      this.state.revision++;
    }
    return structuredClone(this.state);
  }

  act(actor: string, peers: { id: string; handle: string }[], action: TicTacToeAction): void {
    if (peers.length !== 2 || !peers.some((peer) => peer.id === actor))
      throw new Error('This game is for the two current chat participants.');
    this.snapshot();
    const state = this.state;
    if (action.action === 'invite') {
      if (state.game) throw new Error('Open the current game to play or request a rematch.');
      if (state.invitation) throw new Error('Answer the pending invitation first.');
      state.invitation = {
        id: crypto.randomUUID(), fromId: actor,
        fromHandle: peers.find((peer) => peer.id === actor)!.handle,
        expiresAt: Date.now() + 90000,
      };
    } else if (action.action === 'respond') {
      const invitation = state.invitation;
      if (!invitation || invitation.id !== action.invitationId)
        throw new Error('That invitation is no longer available.');
      if (action.accept && invitation.fromId === actor)
        throw new Error('Only your peer can accept this invitation.');
      if (action.accept) {
        const ordered = [...peers].sort((a) => a.id === invitation.fromId ? -1 : 1);
        state.game = {
          id: crypto.randomUUID(), round: 1,
          players: ordered.map((peer, index) => ({ ...peer, mark: index === 0 ? 'X' : 'O' })),
          board: Array(9).fill(null), turn: 'X', result: null, winningLine: [], rematch: [],
        };
      }
      state.invitation = null;
    } else {
      const game = state.game;
      if (!game || game.id !== action.gameId || game.round !== action.round)
        throw new Error('That round is no longer available.');
      if (action.action === 'rematch') {
        if (!game.result) throw new Error('Finish this round first.');
        if (game.rematch.includes(actor)) return;
        game.rematch.push(actor);
        if (game.rematch.length === 2) {
          game.round++;
          game.board = Array(9).fill(null);
          game.turn = game.round % 2 === 0 ? 'O' : 'X';
          game.result = null;
          game.winningLine = [];
          game.rematch = [];
        }
      } else if (action.action === 'move') {
        if (action.revision !== state.revision) throw new Error('The board changed. Try again.');
        if (game.result) throw new Error('This round is over.');
        const player = game.players.find((peer) => peer.id === actor)!;
        if (player.mark !== game.turn) throw new Error('It is not your turn.');
        if (!Number.isInteger(action.square) || action.square < 0 || action.square > 8 || game.board[action.square])
          throw new Error('Choose an empty square.');
        game.board[action.square] = player.mark;
        game.winningLine = LINES.find((line) => line.every((square) => game.board[square] === player.mark)) ?? [];
        game.result = game.winningLine.length ? player.mark : game.board.every(Boolean) ? 'draw' : null;
        if (!game.result) game.turn = game.turn === 'X' ? 'O' : 'X';
      } else throw new Error('Invalid game action.');
    }
    state.revision++;
  }
}
