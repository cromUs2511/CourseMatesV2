import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Minimize2, RotateCw, Flag, X } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import type {
  ChessState,
  ChessAction,
  ChessPieceColor,
  ChessPiece,
  ChessBoard,
  ChessPieceType,
  PeerGameActivity,
} from '../data/peerGames';
import { GameInvitation } from './GameInvitation';
import { LeaveGameButton } from './GameLeave';
import { usePeerGameActivity } from './usePeerGameActivity';

export type PeerChessHandle = { open: () => void };

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

// Solid glyphs for both sides; the \uFE0E selector stops emoji rendering.
const SOLID_SYMBOLS: Record<ChessPieceType, string> = {
  king: '♚\uFE0E',
  queen: '♛\uFE0E',
  rook: '♜\uFE0E',
  bishop: '♝\uFE0E',
  knight: '♞\uFE0E',
  pawn: '♟\uFE0E',
};

// White pieces: white fill, black outline. Black pieces: near-black fill, white outline.
function pieceStyle(color: ChessPieceColor): CSSProperties {
  return color === 'white'
    ? {
        color: '#ffffff',
        textShadow:
          '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000',
      }
    : {
        color: '#111111',
        textShadow:
          '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 3px #fff',
      };
}

export const PeerChess = forwardRef<
  PeerChessHandle,
  {
    roomId: string;
    sessionId: string;
    peerHandle: string;
    ws?: WebSocket;
    onActivity?: (activity: PeerGameActivity | null) => void;
  }
>(function PeerChess({ roomId, sessionId, peerHandle, ws, onActivity }, ref) {
  const [state, setState] = useState<ChessState>({
    revision: -1,
    game: null,
    invitation: null,
    leftBy: null,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);
  const [legalMoves, setLegalMoves] = useState<[number, number][]>([]);
  const [flipped, setFlipped] = useState(false);
  const sending = useRef(false);
  const seenRound = useRef('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [promotion, setPromotion] = useState<{
    from: [number, number];
    to: [number, number];
  } | null>(null);
  const apply = useCallback((next: ChessState) => {
    setState((current) => (next.revision > current.revision ? next : current));
  }, []);
  // Fast sync while inviting or playing; slow safety net when idle.
  const isLive = !!(state.invitation || (state.game && !state.game.result));
  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await apiRequest<ChessState>(
          '/api/chat/chess?roomId=' + encodeURIComponent(roomId),
        );
        if (!disposed) apply(next);
      } catch {
        /* REST retries recover a dropped socket. */
      } finally {
        polling = false;
      }
    };
    const receive = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'chess_state' && data.roomId === roomId) apply(data.state);
      } catch {
        /* Polling repairs malformed events. */
      }
    };
    ws?.addEventListener('message', receive);
    void poll();
    const timer = window.setInterval(poll, isLive ? 1500 : 10000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      ws?.removeEventListener('message', receive);
    };
  }, [apply, roomId, ws, isLive]);
  const game = state.game;
  useEffect(() => {
    // A cleared match (peer left) closes the board for both sides.
    if (!game) {
      setOpen(false);
      return;
    }
    const round = `${game.id}:${game.round}`;
    if (seenRound.current !== round) {
      seenRound.current = round;
      // Colors can swap between rounds: drop any stale selection/highlights.
      setSelectedSquare(null);
      setLegalMoves([]);
      setPromotion(null);
      setOpen(true);
    }
  }, [game]);
  useEffect(() => {
    if (!open || !game) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, [open, game?.id]);
  useEffect(() => {
    if (game?.result) playChime('match');
  }, [game?.result]);
  const send = async (action: ChessAction) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      apply(await apiRequest<ChessState>('/api/chat/chess', { roomId, ...action }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  useImperativeHandle(ref, () => ({
    open: () => {
      if (game) setOpen(true);
      else if (!state.invitation) void send({ action: 'invite' });
    },
  }));
  const you = game?.players.find((player) => player.id === sessionId);
  const opponent = game?.players.find((player) => player.id !== sessionId);
  const yourColor = you?.color;
  const yourTurn = game && !game.result && yourColor && yourColor === game.turn;
  const gameOver = !!game?.result;
  const inCheck = game?.inCheck === yourColor;
  const opponentInCheck = game?.inCheck && game.inCheck !== yourColor;
  const lastMove = game?.lastMove;
  // Each player sees their own pieces at the bottom: black auto-flips,
  // and the manual toggle inverts whichever default applies.
  const boardFlipped = flipped !== (yourColor === 'black');
  const chessActivity = state.invitation
    ? {
        status: state.invitation.fromId === sessionId ? 'Invitation sent' : 'Invitation received',
        incoming: state.invitation.fromId !== sessionId,
      }
    : game && !game.result
      ? {
          status: inCheck
            ? 'Check — your move'
            : yourTurn
              ? 'Your move'
              : `${opponent?.handle ?? 'Peer'}'s turn`,
          incoming: false,
        }
      : null;
  usePeerGameActivity(onActivity, 'chess', 'Chess', chessActivity);
  const getSquareCoords = (row: number, col: number): [number, number] => {
    if (boardFlipped) return [7 - row, 7 - col];
    return [row, col];
  };
  const handleSquareClick = (row: number, col: number) => {
    if (!yourTurn || busy || gameOver || !game) return;
    const [r, c] = getSquareCoords(row, col);
    const piece = game.board[r]![c];
    if (selectedSquare) {
      const sr = selectedSquare[0];
      const sc = selectedSquare[1];
      if (sr === r && sc === c) {
        setSelectedSquare(null);
        setLegalMoves([]);
        return;
      }
      const isLegal = legalMoves.some(([mr, mc]) => mr === r && mc === c);
      if (isLegal) {
        const movingPiece = game.board[sr]![sc];
        const isPromotion = movingPiece?.type === 'pawn' && (r === 0 || r === 7);
        if (isPromotion) {
          setPromotion({ from: [sr, sc], to: [r, c] });
          setSelectedSquare(null);
          setLegalMoves([]);
          return;
        }
        void send({
          action: 'move',
          gameId: game.id,
          round: game.round,
          revision: state.revision,
          from: [sr, sc],
          to: [r, c],
        } as ChessAction);
        setSelectedSquare(null);
        setLegalMoves([]);
      } else if (piece && piece.color === yourColor) {
        setSelectedSquare([r, c]);
        setLegalMoves(calculateLegalMoves(game, r, c, yourColor));
      } else {
        setSelectedSquare(null);
        setLegalMoves([]);
      }
    } else if (piece && piece.color === yourColor) {
      setSelectedSquare([r, c]);
      setLegalMoves(calculateLegalMoves(game, r, c, yourColor));
    }
  };
  const handlePromotion = (promotionType: ChessPieceType) => {
    if (!promotion || !game) return;
    const { from, to } = promotion;
    setPromotion(null);
    void send({
      action: 'move',
      gameId: game.id,
      round: game.round,
      revision: state.revision,
      from,
      to,
      promotion: promotionType,
    } as ChessAction);
  };
  const calculateLegalMoves = (
    gameState: ChessState['game'],
    fromRow: number,
    fromCol: number,
    color: ChessPieceColor,
  ): [number, number][] => {
    const moves: [number, number][] = [];
    const piece = gameState!.board[fromRow]![fromCol];
    if (!piece) return moves;
    const directions = getPieceDirections(piece.type);
    for (const [dr, dc] of directions) {
      let r = fromRow + dr;
      let c = fromCol + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = gameState!.board[r]![c];
        if (target) {
          if (target.color !== color) moves.push([r, c]);
          break;
        }
        moves.push([r, c]);
        if (piece.type !== 'rook' && piece.type !== 'bishop' && piece.type !== 'queen') break;
        r += dr;
        c += dc;
      }
    }
    if (piece.type === 'knight') {
      const knightMoves: [number, number][] = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];
      for (const [dr, dc] of knightMoves) {
        const r = fromRow + dr,
          c = fromCol + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const target = gameState!.board[r]![c];
          if (!target || target.color !== color) moves.push([r, c]);
        }
      }
    }
    if (piece.type === 'pawn') {
      const dir = color === 'white' ? -1 : 1;
      const startRow = color === 'white' ? 6 : 1;
      if (fromRow + dir >= 0 && fromRow + dir < 8 && !gameState!.board[fromRow + dir]![fromCol]) {
        moves.push([fromRow + dir, fromCol]);
        if (fromRow === startRow && !gameState!.board[fromRow + 2 * dir]![fromCol])
          moves.push([fromRow + 2 * dir, fromCol]);
      }
      for (const dc of [-1, 1]) {
        const r = fromRow + dir,
          c = fromCol + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const target = gameState!.board[r]![c];
          if (target && target.color !== color) moves.push([r, c]);
        }
      }
    }
    if (piece.type === 'king') {
      if (!piece.hasMoved) {
        if (
          !gameState!.board[fromRow]![fromCol + 1] &&
          !gameState!.board[fromRow]![fromCol + 2] &&
          gameState!.board[fromRow]![fromCol + 3]?.type === 'rook' &&
          !gameState!.board[fromRow]![fromCol + 3]?.hasMoved
        ) {
          moves.push([fromRow, fromCol + 2]);
        }
        if (
          !gameState!.board[fromRow]![fromCol - 1] &&
          !gameState!.board[fromRow]![fromCol - 2] &&
          !gameState!.board[fromRow]![fromCol - 3] &&
          gameState!.board[fromRow]![fromCol - 4]?.type === 'rook' &&
          !gameState!.board[fromRow]![fromCol - 4]?.hasMoved
        ) {
          moves.push([fromRow, fromCol - 2]);
        }
      }
    }
    return moves;
  };
  const getPieceDirections = (type: ChessPiece['type']): [number, number][] => {
    switch (type) {
      case 'rook':
        return [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ];
      case 'bishop':
        return [
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ];
      case 'queen':
        return [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ];
      case 'king':
        return [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ];
      default:
        return [];
    }
  };
  const getDisplayBoard = (): ChessBoard => {
    if (!game) return Array.from({ length: 8 }, (): ChessBoard[number] => Array(8).fill(null));
    const board = game.board;
    if (boardFlipped) {
      return board.map((row) => [...row].reverse()).reverse();
    }
    return board;
  };
  const handleDrawOffer = () =>
    void send({
      action: 'offerDraw',
      gameId: game!.id,
      round: game!.round,
      revision: state.revision,
    });
  const handleDrawRespond = (accept: boolean) =>
    void send({
      action: 'respondDraw',
      gameId: game!.id,
      round: game!.round,
      revision: state.revision,
      accept,
    });
  const handleResign = () =>
    void send({ action: 'resign', gameId: game!.id, round: game!.round, revision: state.revision });
  const displayBoard = getDisplayBoard();
  return (
    <>
      {state.invitation && (
        <GameInvitation
          game="Chess"
          sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle}
          incoming={state.invitation.fromId !== sessionId}
          busy={busy}
          onRespond={(accept) =>
            void send({ action: 'respond', invitationId: state.invitation!.id, accept })
          }
        />
      )}
      {/* Game-leave events now live in the message timeline as system messages. */}
      {error && !open && (
        <p role="alert" className="mx-auto max-w-3xl py-2 text-sm text-red-500">
          {error}
        </p>
      )}
      {open && game && (
        <dialog
          ref={dialogRef}
          aria-label="Chess"
          onCancel={() => setOpen(false)}
          className="m-auto max-h-[var(--app-height,100dvh)] w-full max-w-2xl overflow-y-auto border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 backdrop:bg-black/70 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100 sm:rounded-xl"
        >
          <header className="flex items-center justify-between border-b border-stone-300 pb-4 dark:border-stone-700">
            <div>
              <h2 className="text-lg font-bold">Chess</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Chat 1v1 · Round {game.round}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFlipped(!flipped)}
                aria-label="Flip board"
                title="Flip board"
                className="rounded-lg p-2 hover:bg-stone-500/10"
              >
                <RotateCw className="h-5 w-5" />
              </button>
              <LeaveGameButton
                gameId={game.id}
                busy={busy}
                onLeave={() => void send({ action: 'leave' })}
              />
              <button
                type="button"
                aria-label="Minimize Chess"
                onClick={() => setOpen(false)}
                className="rounded-lg p-3 hover:bg-stone-500/10"
              >
                <Minimize2 className="h-5 w-5" />
              </button>
            </div>
          </header>
          <div className="my-4 flex justify-between gap-4 text-sm">
            {game.players.map((player) => (
              <span key={player.id} className="min-w-0 truncate flex items-center gap-1">
                <strong className={player.id === sessionId ? 'text-stone-900 dark:text-white' : ''}>
                  {player.id === sessionId ? 'You' : player.handle}
                </strong>{' '}
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ring-1 ${
                    player.color === 'white'
                      ? 'bg-white text-stone-900 ring-stone-400'
                      : 'bg-stone-900 text-white ring-stone-600'
                  }`}
                >
                  {player.color}
                </span>
              </span>
            ))}
          </div>
          <div className="mb-4 flex items-center justify-between gap-4 text-sm">
            <p role="status" className="font-semibold" aria-live="polite">
              {gameOver
                ? game.result?.reason === 'checkmate' && game.result.winnerId === sessionId
                  ? 'Checkmate! You win! 🎉'
                  : game.result?.reason === 'checkmate'
                    ? `Checkmate! ${opponent?.handle} wins.`
                    : game.result?.reason === 'resignation'
                      ? game.result.winnerId === sessionId
                        ? 'Opponent resigned. You win! 🎉'
                        : 'You resigned.'
                      : game.result?.reason === 'draw-agreed'
                        ? 'Draw agreed.'
                        : 'Stalemate — draw!'
                : inCheck
                  ? '⚠ You are in check!'
                  : opponentInCheck
                    ? '⚠ Opponent in check!'
                    : yourTurn
                      ? 'Your move'
                      : `${opponent?.handle}'s turn`}
            </p>
            <div className="flex items-center gap-2">
              {!gameOver && game.drawOfferedBy && game.drawOfferedBy !== sessionId && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDrawRespond(true)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    Accept Draw
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDrawRespond(false)}
                    className="rounded-lg border border-stone-400 px-3 py-1.5 text-xs font-bold dark:border-stone-600"
                  >
                    Decline
                  </button>
                </>
              )}
              {!gameOver && !game.drawOfferedBy && yourTurn && (
                <button
                  type="button"
                  onClick={handleDrawOffer}
                  className="rounded-lg border border-stone-400 px-3 py-1.5 text-xs font-bold dark:border-stone-600"
                >
                  Offer Draw
                </button>
              )}
              {!gameOver && yourTurn && (
                <button
                  type="button"
                  onClick={handleResign}
                  className="rounded-lg border border-red-500 px-3 py-1.5 text-xs font-bold text-red-600 dark:border-red-400"
                >
                  Resign
                </button>
              )}
            </div>
          </div>
          <div
            className="chess-board mx-auto mb-4"
            style={{ width: '100%', maxWidth: '480px', aspectRatio: '1 / 1' }}
            role="grid"
            aria-label="Chess board"
          >
            {displayBoard.map((row, rowIndex) => (
              <div key={rowIndex} className="flex" style={{ height: '12.5%' }}>
                {row.map((piece, colIndex) => {
                  // Selection, hints and last-move state live in board
                  // coordinates; map the displayed square back first.
                  const lr = boardFlipped ? 7 - rowIndex : rowIndex;
                  const lc = boardFlipped ? 7 - colIndex : colIndex;
                  const isSelected =
                    selectedSquare && selectedSquare[0] === lr && selectedSquare[1] === lc;
                  const isLegal = legalMoves.some(([r, c]) => r === lr && c === lc);
                  const isLastMoveSquare =
                    lastMove &&
                    ((lastMove.from[0] === lr && lastMove.from[1] === lc) ||
                      (lastMove.to[0] === lr && lastMove.to[1] === lc));
                  const isCheck =
                    game.inCheck && piece && piece.color === game.inCheck && piece.type === 'king';
                  return (
                    <button
                      key={`${rowIndex}-${colIndex}`}
                      type="button"
                      onClick={() => handleSquareClick(rowIndex, colIndex)}
                      disabled={busy || gameOver || !yourTurn}
                      className={`chess-square flex aspect-square items-center justify-center text-4xl transition-colors motion-reduce:transition-none ${
                        isLegal
                          ? 'bg-green-300 dark:bg-green-700'
                          : (rowIndex + colIndex) % 2 === 0
                            ? 'bg-amber-100 dark:bg-stone-400'
                            : 'bg-amber-700 dark:bg-stone-600'
                      } ${isSelected ? 'ring-2 ring-blue-500' : ''} ${isLastMoveSquare ? 'ring-2 ring-blue-400' : ''} ${isCheck ? 'ring-2 ring-red-500' : ''}`}
                      style={{ width: '12.5%' }}
                      aria-label={`${FILES[lc]}${RANKS[lr]}${piece ? `, ${piece.color} ${piece.type}` : ', empty'}`}
                    >
                      {piece && (
                        <span style={pieceStyle(piece.color)} className="select-none leading-none">
                          {SOLID_SYMBOLS[piece.type]}
                        </span>
                      )}
                      {isLegal && !piece && (
                        <span
                          className="h-3 w-3 rounded-full bg-green-800 dark:bg-green-200"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="flex" style={{ height: '1.5rem' }}>
              {FILES.map((file, i) => (
                <div
                  key={file}
                  className="flex items-center justify-center text-xs text-stone-700 dark:text-stone-300"
                  style={{ width: '12.5%' }}
                >
                  {boardFlipped ? FILES[7 - i] : file}
                </div>
              ))}
            </div>
          </div>
          {promotion && yourTurn && !gameOver && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
              onClick={() => setPromotion(null)}
            >
              <div
                className="rounded-2xl bg-stone-900 p-6 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="mb-4 text-lg font-bold text-white">Promote pawn to:</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(['queen', 'rook', 'bishop', 'knight'] as ChessPieceType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handlePromotion(type)}
                      className="rounded-xl border border-stone-600 bg-stone-800 p-3 font-bold text-white hover:bg-stone-700"
                    >
                      <span className="mr-1 text-2xl">{SOLID_SYMBOLS[type]}</span>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-500">
              {error}
            </p>
          )}
          {gameOver && (
            <button
              type="button"
              disabled={busy || game.rematch.includes(sessionId)}
              onClick={() => void send({ action: 'rematch', gameId: game.id, round: game.round })}
              className="mt-5 w-full rounded-lg bg-[var(--chat-accent)] py-3 font-semibold text-white disabled:opacity-60"
            >
              {game.rematch.includes(sessionId)
                ? 'Waiting for your peer…'
                : game.rematch.length
                  ? 'Accept rematch'
                  : 'Request rematch'}
            </button>
          )}
          <p className="mt-4 text-center text-xs text-stone-500 dark:text-stone-400">
            Shared live with {peerHandle}. Minimize to keep chatting.
          </p>
        </dialog>
      )}
    </>
  );
});
