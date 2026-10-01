import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import type { ConnectFourState, ConnectFourAction, PeerGameActivity } from '../data/peerGames';
import { GameInvitation } from './GameInvitation';
import { usePeerGameActivity } from './usePeerGameActivity';
import '../connectfour.css';

export type PeerConnectFourHandle = { open: () => void };

const ROWS = 6;
const COLS = 7;

export const PeerConnectFour = forwardRef<
  PeerConnectFourHandle,
  {
    roomId: string;
    sessionId: string;
    peerHandle: string;
    ws?: WebSocket;
    onActivity?: (activity: PeerGameActivity | null) => void;
  }
>(function PeerConnectFour({ roomId, sessionId, peerHandle, ws, onActivity }, ref) {
  const [state, setState] = useState<ConnectFourState>({
    revision: -1,
    game: null,
    invitation: null,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [winningCells, setWinningCells] = useState<number[]>([]);
  const sending = useRef(false);
  const seenRound = useRef('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const apply = useCallback((next: ConnectFourState) => {
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
        const next = await apiRequest<ConnectFourState>(
          '/api/chat/connectfour?roomId=' + encodeURIComponent(roomId),
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
        if (data.type === 'connectfour_state' && data.roomId === roomId) apply(data.state);
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
    if (!game) return;
    const round = `${game.id}:${game.round}`;
    if (seenRound.current !== round) {
      seenRound.current = round;
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
    if (game?.result?.winningCells) {
      setWinningCells(game.result.winningCells);
      playChime('match');
    }
  }, [game?.result]);
  const send = async (action: ConnectFourAction) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      apply(await apiRequest<ConnectFourState>('/api/chat/connectfour', { roomId, ...action }));
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
  const yourTurn = game && !game.result && you && you.color === game.turn;
  const cfActivity = state.invitation
    ? {
        status: state.invitation.fromId === sessionId ? 'Invitation sent' : 'Invitation received',
        incoming: state.invitation.fromId !== sessionId,
      }
    : game && !game.result
      ? {
          status: yourTurn ? 'Your turn' : `${opponent?.handle ?? 'Peer'}'s turn`,
          incoming: false,
        }
      : null;
  usePeerGameActivity(onActivity, 'connectfour', 'Connect Four', cfActivity);
  const handleColumnClick = (col: number) => {
    if (!yourTurn || busy || game?.result) return;
    void send({
      action: 'move',
      gameId: game!.id,
      round: game!.round,
      revision: state.revision,
      column: col,
    });
  };
  const getCell = (row: number, col: number) => {
    if (!game)
      return { cell: null as ('red' | 'yellow') | null, isWinning: false, isLastMove: false };
    const cell = game.board[row]?.[col] ?? null;
    const isWinning = winningCells.includes(row * COLS + col);
    const serverLastMove = game.lastMove;
    const isLastMove = !!serverLastMove && serverLastMove.row === row && serverLastMove.col === col;
    return { cell, isWinning, isLastMove };
  };
  return (
    <>
      {state.invitation && (
        <GameInvitation
          game="Connect Four"
          sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle}
          incoming={state.invitation.fromId !== sessionId}
          busy={busy}
          onRespond={(accept) =>
            void send({ action: 'respond', invitationId: state.invitation!.id, accept })
          }
        />
      )}
      {error && !open && (
        <p role="alert" className="mx-auto max-w-3xl py-2 text-sm text-red-500">
          {error}
        </p>
      )}
      {open && game && (
        <dialog
          ref={dialogRef}
          aria-label="Connect Four"
          onCancel={() => setOpen(false)}
          className="m-auto max-h-[var(--app-height,100dvh)] w-full max-w-lg overflow-y-auto border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 backdrop:bg-black/70 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100 sm:rounded-xl"
        >
          <header className="flex items-center justify-between border-b border-stone-300 pb-4 dark:border-stone-700">
            <div>
              <h2 className="text-lg font-bold">Connect Four</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Chat 1v1 · Round {game.round}
              </p>
            </div>
            <button
              type="button"
              aria-label="Minimize Connect Four"
              onClick={() => setOpen(false)}
              className="rounded-lg p-3 hover:bg-stone-500/10"
            >
              <Minimize2 className="h-5 w-5" />
            </button>
          </header>
          <div className="my-4 flex justify-between gap-4 text-sm">
            {game.players.map((player) => (
              <span key={player.id} className="min-w-0 truncate flex items-center gap-1">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${player.color === 'red' ? 'bg-red-500' : 'bg-yellow-400'}`}
                  aria-hidden="true"
                />
                <strong className={player.id === sessionId ? 'text-stone-900 dark:text-white' : ''}>
                  {player.id === sessionId ? 'You' : player.handle}
                </strong>
              </span>
            ))}
          </div>
          <p role="status" className="mb-4 text-center font-semibold" aria-live="polite">
            {game.result
              ? game.result.winnerId === sessionId
                ? 'You win! 🎉'
                : game.result.winnerId
                  ? `${game.players.find((p) => p.id === game.result!.winnerId)?.handle} wins!`
                  : 'Draw!'
              : yourTurn
                ? 'Your turn — pick a column'
                : `${opponent?.handle}'s turn`}
          </p>
          <div className="cf-board mx-auto" role="grid" aria-label="Connect Four board">
            <div
              className="cf-columns"
              style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: '4px' }}
            >
              {Array.from({ length: COLS }, (_, col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => handleColumnClick(col)}
                  disabled={busy || !!game.result || !yourTurn || game?.board[0]?.[col] !== null}
                  aria-label={`Column ${col + 1}${game?.board[0]?.[col] ? ' (full)' : ''}`}
                  className="cf-col-btn h-10 w-full rounded-t-lg border border-stone-300 bg-stone-100 text-stone-400 font-bold transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-500 dark:hover:bg-stone-800"
                  style={{ minWidth: '40px' }}
                >
                  ▼
                </button>
              ))}
            </div>
            <div
              className="cf-grid relative"
              style={{
                display: 'grid',
                gridTemplateRows: `repeat(${ROWS}, 1fr)`,
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gap: '4px',
                marginTop: '4px',
              }}
            >
              {Array.from({ length: ROWS }, (_, row) =>
                Array.from({ length: COLS }, (_, col) => {
                  const { cell, isWinning, isLastMove } = getCell(row, col);
                  return (
                    <div
                      key={`${row}-${col}`}
                      className={`cf-cell relative aspect-square rounded-full border-2 transition-all duration-300 motion-reduce:transition-none ${isWinning ? 'border-emerald-500 bg-emerald-500/20 animate-pulse motion-reduce:animate-none' : 'border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-900'} ${isLastMove ? 'ring-2 ring-blue-400' : ''}`}
                      style={{ minWidth: '40px', minHeight: '40px' }}
                    >
                      {cell && (
                        <div
                          className={`cf-piece absolute inset-1 m-auto rounded-full ${cell === 'red' ? 'bg-red-500' : 'bg-yellow-400'} ${isLastMove ? 'cf-drop-in' : ''}`}
                          style={{ width: '90%', height: '90%' }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-500">
              {error}
            </p>
          )}
          {game.result && (
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
