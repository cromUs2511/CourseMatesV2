import crypto from 'node:crypto';
import { Chess, type PieceSymbol } from 'chess.js';
import type {
  ChessState,
  ChessAction,
  ChessPieceColor,
  ChessBoard,
  ChessPiece,
} from './src/data/peerGames';

const TYPE_FROM_SYMBOL: Record<PieceSymbol, ChessPiece['type']> = {
  p: 'pawn',
  r: 'rook',
  n: 'knight',
  b: 'bishop',
  q: 'queen',
  k: 'king',
};

const PROMOTION_SYMBOL: Record<ChessPiece['type'], PieceSymbol> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  pawn: 'p',
  king: 'k',
};

// Only these four pieces are legal promotion targets.
const PROMOTABLE: ReadonlySet<string> = new Set(['queen', 'rook', 'bishop', 'knight']);

/**
 * Convert a chess.js position to the CourseMates board shape.
 * chess.board() returns rank 8 first, matching board[0] === rank 8.
 */
function chessToBoard(chess: Chess): ChessBoard {
  const raw = chess.board();
  return raw.map((rankRow) =>
    rankRow.map((cell) => {
      if (!cell) return null;
      const type = TYPE_FROM_SYMBOL[cell.type];
      if (!type) throw new Error('Unknown piece type.');
      return {
        type,
        color: cell.color === 'w' ? ('white' as ChessPieceColor) : ('black' as ChessPieceColor),
      };
    }),
  );
}

function isSquare(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 8)
  );
}

function toAlgebraic(square: [number, number]): string {
  return String.fromCharCode(97 + square[1]) + (8 - square[0]);
}

export class PeerChess {
  private state: ChessState = { revision: 0, invitation: null, game: null, leftBy: null };
  // Who played White last. Survives game teardown so the next game flips roles.
  private lastWhiteId: string | null = null;

  snapshot(now = Date.now()): ChessState {
    if (this.state.invitation && this.state.invitation.expiresAt <= now) {
      this.state.invitation = null;
      this.state.revision++;
    }
    return structuredClone(this.state);
  }

  act(actor: string, peers: { id: string; handle: string }[], action: ChessAction): void {
    if (peers.length !== 2 || !peers.some((peer) => peer.id === actor))
      throw new Error('This game is for the two current chat participants.');
    this.snapshot();
    const state = this.state;

    if (action.action === 'invite') {
      if (state.game && !state.game.result)
        throw new Error('Open the current game to play or request a rematch.');
      // A finished round auto-terminates so a new invitation needs no manual leave.
      if (state.game) state.game = null;
      if (state.invitation) throw new Error('Answer the pending invitation first.');
      state.invitation = {
        id: crypto.randomUUID(),
        fromId: actor,
        fromHandle: peers.find((peer) => peer.id === actor)!.handle,
        expiresAt: Date.now() + 90000,
      };
      state.leftBy = null;
    } else if (action.action === 'respond') {
      const invitation = state.invitation;
      if (!invitation || invitation.id !== action.invitationId)
        throw new Error('That invitation is no longer available.');
      if (action.accept && invitation.fromId === actor)
        throw new Error('Only your peer can accept this invitation.');
      if (action.accept) {
        // First game in a room: random. Every later game: the other player gets White.
        const previousWhite = peers.find((peer) => peer.id === this.lastWhiteId);
        const white = previousWhite
          ? peers.find((peer) => peer.id !== previousWhite.id)!
          : peers[crypto.randomInt(2)]!;
        this.lastWhiteId = white.id;
        // Keep the inviter listed first so the UI header order is unchanged.
        const ordered = [
          peers.find((peer) => peer.id === invitation.fromId)!,
          peers.find((peer) => peer.id !== invitation.fromId)!,
        ];
        const chess = new Chess();
        state.game = {
          id: crypto.randomUUID(),
          round: 1,
          players: ordered.map((peer) => ({
            ...peer,
            color: (peer.id === white.id ? 'white' : 'black') as ChessPieceColor,
          })),
          board: chessToBoard(chess),
          fen: chess.fen(),
          turn: 'white',
          result: null,
          inCheck: null,
          lastMove: null,
          drawOfferedBy: null,
          rematch: [],
        };
      }
      state.invitation = null;
      state.leftBy = null;
    } else if (action.action === 'leave') {
      state.invitation = null;
      if (state.game) {
        const leaver = state.game.players.find((p) => p.id === actor);
        state.leftBy = { id: actor, handle: leaver?.handle ?? 'Your peer' };
        state.game = null;
      }
    } else {
      const game = state.game;
      if (!game || game.id !== action.gameId || game.round !== action.round)
        throw new Error('That round is no longer available.');

      let chess: Chess;
      try {
        chess = new Chess(game.fen);
      } catch {
        throw new Error('That position is no longer available.');
      }

      if (action.action === 'rematch') {
        if (!game.result) throw new Error('Finish this round first.');
        if (game.rematch.includes(actor)) return;
        game.rematch.push(actor);
        if (game.rematch.length === 2) {
          game.round++;
          // Alternate sides every round.
          game.players = game.players.map((p) => ({
            ...p,
            color: (p.color === 'white' ? 'black' : 'white') as ChessPieceColor,
          }));
          this.lastWhiteId = game.players.find((p) => p.color === 'white')!.id;
          const newChess = new Chess();
          game.board = chessToBoard(newChess);
          game.fen = newChess.fen();
          game.turn = 'white';
          game.result = null;
          game.inCheck = null;
          game.lastMove = null;
          game.drawOfferedBy = null;
          game.rematch = [];
        }
      } else if (action.action === 'move') {
        if (game.result) throw new Error('This round is over.');
        if (game.drawOfferedBy) throw new Error('A draw has been offered. Respond first.');

        const player = game.players.find((p) => p.id === actor)!;
        // The engine position is the source of truth for whose turn it is:
        // White opens, then Black always replies.
        const turnColor: ChessPieceColor = chess.turn() === 'w' ? 'white' : 'black';
        if (player.color !== turnColor) throw new Error('It is not your turn.');
        if (!isSquare(action.from) || !isSquare(action.to))
          throw new Error('Choose two squares on the board.');
        if (action.promotion !== undefined && !PROMOTABLE.has(action.promotion))
          throw new Error('Choose a valid promotion piece.');

        try {
          const move = chess.move({
            from: toAlgebraic(action.from),
            to: toAlgebraic(action.to),
            promotion:
              action.promotion === undefined
                ? undefined
                : PROMOTION_SYMBOL[action.promotion as ChessPiece['type']],
          });

          game.board = chessToBoard(chess);
          game.fen = chess.fen();
          game.turn = chess.turn() === 'w' ? 'white' : 'black';
          game.lastMove = {
            from: action.from,
            to: action.to,
            piece: {
              type: TYPE_FROM_SYMBOL[move.piece],
              color: move.color === 'w' ? 'white' : 'black',
            },
          };

          if (chess.isCheckmate()) {
            game.result = { winnerId: actor, reason: 'checkmate' };
            game.inCheck = null;
          } else if (
            chess.isStalemate() ||
            chess.isDraw() ||
            chess.isThreefoldRepetition() ||
            chess.isInsufficientMaterial()
          ) {
            game.result = { winnerId: null, reason: 'stalemate' };
            game.inCheck = null;
          } else if (chess.isCheck()) {
            game.inCheck = chess.turn() === 'w' ? 'white' : 'black';
          } else {
            game.inCheck = null;
          }
        } catch (e) {
          // eslint-disable-next-line preserve-caught-error
          throw new Error('Invalid move.');
        }
      } else if (action.action === 'offerDraw') {
        if (game.result) throw new Error('This round is over.');
        if (game.drawOfferedBy) throw new Error('A draw has already been offered.');
        game.drawOfferedBy = actor;
      } else if (action.action === 'respondDraw') {
        if (game.result) throw new Error('This round is over.');
        if (!game.drawOfferedBy || game.drawOfferedBy === actor)
          throw new Error('No draw offered to respond to.');
        if (action.accept) {
          game.result = { winnerId: null, reason: 'draw-agreed' };
          game.drawOfferedBy = null;
        } else {
          game.drawOfferedBy = null;
        }
      } else if (action.action === 'resign') {
        if (game.result) throw new Error('This round is over.');
        const opponent = game.players.find((p) => p.id !== actor)!;
        game.result = { winnerId: opponent.id, reason: 'resignation' };
      } else throw new Error('Invalid game action.');
    }
    state.revision++;
  }
}
