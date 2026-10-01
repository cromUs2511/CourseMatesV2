import crypto from 'node:crypto';
import type { ConnectFourState, ConnectFourAction } from './src/data/peerGames';

const ROWS = 6;
const COLS = 7;

function emptyBoard(): (('red' | 'yellow') | null)[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function checkWin(
  board: (('red' | 'yellow') | null)[][],
  row: number,
  col: number,
  color: 'red' | 'yellow',
): number[] {
  const directions: [number, number][] = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal down-right
    [1, -1], // diagonal down-left
  ];

  for (const dir of directions) {
    const dr = dir[0];
    const dc = dir[1];
    const cells: [number, number][] = [[row, col]];
    for (let d = -1; d <= 1; d += 2) {
      let r = row + dr * d;
      let c = col + dc * d;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r]![c]! === color) {
        cells.push([r, c]);
        r += dr * d;
        c += dc * d;
      }
    }
    if (cells.length >= 4) {
      return cells.map(([r, c]) => r * COLS + c);
    }
  }
  return [];
}

function isDraw(board: (('red' | 'yellow') | null)[][]): boolean {
  return board[0]!.every((cell) => cell !== null);
}

export class PeerConnectFour {
  private state: ConnectFourState = { revision: 0, invitation: null, game: null };

  snapshot(now = Date.now()): ConnectFourState {
    if (this.state.invitation && this.state.invitation.expiresAt <= now) {
      this.state.invitation = null;
      this.state.revision++;
    }
    return structuredClone(this.state);
  }

  act(actor: string, peers: { id: string; handle: string }[], action: ConnectFourAction): void {
    if (peers.length !== 2 || !peers.some((peer) => peer.id === actor))
      throw new Error('This game is for the two current chat participants.');
    this.snapshot();
    const state = this.state;

    if (action.action === 'invite') {
      if (state.game) throw new Error('Open the current game to play or request a rematch.');
      if (state.invitation) throw new Error('Answer the pending invitation first.');
      state.invitation = {
        id: crypto.randomUUID(),
        fromId: actor,
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
        const ordered = [...peers].sort((a) => (a.id === invitation.fromId ? -1 : 1));
        state.game = {
          id: crypto.randomUUID(),
          round: 1,
          players: ordered.map((peer, index) => ({
            ...peer,
            color: index === 0 ? 'red' : 'yellow',
          })),
          board: emptyBoard(),
          turn: 'red',
          result: null,
          lastMove: null,
          rematch: [],
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
          game.board = emptyBoard();
          game.turn = 'red';
          game.result = null;
          game.lastMove = null;
          game.rematch = [];
        }
      } else if (action.action === 'move') {
        if (game.result) throw new Error('This round is over.');
        const player = game.players.find((p) => p.id === actor)!;
        if (player.color !== game.turn) throw new Error('It is not your turn.');
        if (!Number.isInteger(action.column) || action.column < 0 || action.column >= COLS)
          throw new Error('Invalid column.');

        const col = action.column;
        let row = -1;
        for (let r = ROWS - 1; r >= 0; r--) {
          if (game.board[r]![col] === null) {
            row = r;
            break;
          }
        }
        if (row === -1) throw new Error('Column is full.');

        game.board[row]![col] = player.color;
        game.lastMove = { row, col };
        const winningCells = checkWin(game.board, row, col, player.color);
        if (winningCells.length > 0) {
          game.result = { winnerId: actor, winningCells };
        } else if (isDraw(game.board)) {
          game.result = { winnerId: null, winningCells: [] };
        } else {
          game.turn = game.turn === 'red' ? 'yellow' : 'red';
        }
      } else throw new Error('Invalid game action.');
    }
    state.revision++;
  }
}
