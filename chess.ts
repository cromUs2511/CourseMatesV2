import crypto from 'node:crypto';
import { Chess, type Color, type PieceSymbol } from 'chess.js';
import type { ChessState, ChessAction, ChessPieceColor, ChessBoard, ChessPiece } from './src/data/peerGames';

function chessBoardToArray(chess: Chess): ChessBoard {
  const board: ChessBoard = Array.from({ length: 8 }, () => Array(8).fill(null));
  const ascii = chess.ascii().split('\n');
  for (let rank = 0; rank < 8; rank++) {
    const line = ascii[7 - rank];
    if (!line) continue;
    for (let file = 0; file < 8; file++) {
      const char = line[file * 2 + 2];
      if (char && char !== '.') {
        const color: ChessPieceColor = char === char.toUpperCase() ? 'white' : 'black';
        const typeMap: Record<string, ChessPiece['type']> = {
          p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king',
        };
        const type = typeMap[char.toLowerCase()]!;
        board[rank]![file] = { type, color, hasMoved: false };
      }
    }
  }
  return board;
}

function arrayToChess(board: ChessBoard, turn: ChessPieceColor): Chess {
  const chess = new Chess();
  chess.clear();
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank]![file];
      if (piece) {
        const typeChar = { pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k' }[piece.type] as PieceSymbol;
        const color = piece.color === 'white' ? 'w' : 'b';
        chess.put({ type: typeChar, color }, `${String.fromCharCode(97 + file)}${8 - rank}` as any);
      }
    }
  }
  (chess as any).turn = turn === 'white' ? 'w' : 'b';
  return chess;
}

export class PeerChess {
  private state: ChessState = { revision: 0, invitation: null, game: null };

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
        const ordered = [...peers].sort((a) => a.id === invitation.fromId ? -1 : 1);
        const chess = new Chess();
        state.game = {
          id: crypto.randomUUID(),
          round: 1,
          players: ordered.map((peer, index) => ({ ...peer, color: index === 0 ? 'white' : 'black' })),
          board: chessBoardToArray(chess),
          turn: 'white',
          result: null,
          inCheck: null,
          lastMove: null,
          drawOfferedBy: null,
          rematch: [],
        };
      }
      state.invitation = null;
    } else {
      const game = state.game;
      if (!game || game.id !== action.gameId || game.round !== action.round)
        throw new Error('That round is no longer available.');

      const chess = arrayToChess(game.board, game.turn);

      if (action.action === 'rematch') {
        if (!game.result) throw new Error('Finish this round first.');
        if (game.rematch.includes(actor)) return;
        game.rematch.push(actor);
        if (game.rematch.length === 2) {
          game.round++;
          const newChess = new Chess();
          game.board = chessBoardToArray(newChess);
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
        if (player.color !== game.turn) throw new Error('It is not your turn.');

        try {
          const move = chess.move({
            from: String.fromCharCode(97 + action.from[1]) + (8 - action.from[0]),
            to: String.fromCharCode(97 + action.to[1]) + (8 - action.to[0]),
            promotion: action.promotion || undefined,
          });

          game.board = chessBoardToArray(chess);
          game.turn = chess.turn() === 'w' ? 'white' : 'black';
          game.lastMove = {
            from: action.from,
            to: action.to,
            piece: { type: move.piece as ChessPiece['type'], color: move.color === 'w' ? 'white' : 'black', hasMoved: true },
          };

          if (chess.isCheckmate()) {
            game.result = { winnerId: actor, reason: 'checkmate' };
            game.inCheck = null;
          } else if (chess.isStalemate() || chess.isDraw() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
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
        if (!game.drawOfferedBy || game.drawOfferedBy === actor) throw new Error('No draw offered to respond to.');
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