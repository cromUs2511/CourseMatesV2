import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { apiRequest } from '../utils/api';
import type { TicTacToeAction, TicTacToeState } from '../data/peerGames';
import { GameInvitation } from './GameInvitation';

export type PeerTicTacToeHandle = { open: () => void };

export const PeerTicTacToe = forwardRef<PeerTicTacToeHandle, {
  roomId: string; sessionId: string; peerHandle: string; ws?: WebSocket;
}>(function PeerTicTacToe({ roomId, sessionId, peerHandle, ws }, ref) {
  const [state, setState] = useState<TicTacToeState>({ revision: -1, game: null, invitation: null });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const seenRound = useRef('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const apply = useCallback((next: TicTacToeState) => {
    setState((current) => next.revision > current.revision ? next : current);
  }, []);
  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await apiRequest<TicTacToeState>('/api/chat/tictactoe?roomId=' + encodeURIComponent(roomId));
        if (!disposed) apply(next);
      } catch { /* REST retries recover a dropped socket. */ }
      finally { polling = false; }
    };
    const receive = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'tictactoe_state' && data.roomId === roomId) apply(data.state);
      } catch { /* Polling repairs malformed events. */ }
    };
    ws?.addEventListener('message', receive);
    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => { disposed = true; window.clearInterval(timer); ws?.removeEventListener('message', receive); };
  }, [apply, roomId, ws]);
  const game = state.game;
  useEffect(() => {
    if (!game) return;
    const round = `${game.id}:${game.round}`;
    if (seenRound.current !== round) { seenRound.current = round; setOpen(true); }
  }, [game]);
  useEffect(() => {
    if (!open || !game) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus({ preventScroll: true }); };
  }, [open, game?.id]);
  const send = async (action: TicTacToeAction) => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { apply(await apiRequest<TicTacToeState>('/api/chat/tictactoe', { roomId, ...action })); }
    catch (err) { setError((err as Error).message); }
    finally { sending.current = false; setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ open: () => {
    if (game) setOpen(true);
    else if (!state.invitation) void send({ action: 'invite' });
  } }));
  const you = game?.players.find((player) => player.id === sessionId);
  const turn = game?.players.find((player) => player.mark === game.turn);
  const winner = game?.players.find((player) => player.mark === game.result);
  return <>
    {state.invitation && <GameInvitation game="Tic Tac Toe" sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle} incoming={state.invitation.fromId !== sessionId} busy={busy} onRespond={(accept) => void send({ action: 'respond', invitationId: state.invitation!.id, accept })} />}
    {error && !open && <p role="alert" className="mx-auto max-w-3xl py-2 text-sm text-red-500">{error}</p>}
    {open && game && <dialog ref={dialogRef} aria-label="Tic Tac Toe" onCancel={() => setOpen(false)} className="m-auto max-h-[var(--app-height,100dvh)] w-full max-w-lg overflow-y-auto border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 backdrop:bg-black/70 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100 sm:rounded-xl">
      <header className="flex items-center justify-between border-b border-stone-300 pb-4 dark:border-stone-700">
        <div><h2 className="text-lg font-bold">Tic Tac Toe</h2><p className="text-xs text-stone-500 dark:text-stone-400">Chat 1v1 · Round {game.round}</p></div>
        <button type="button" aria-label="Minimize Tic Tac Toe" onClick={() => setOpen(false)} className="rounded-lg p-3 hover:bg-stone-500/10"><Minimize2 className="h-5 w-5" /></button>
      </header>
      <div className="my-4 flex justify-between gap-4 text-sm">{game.players.map((player) => <span key={player.id} className="min-w-0 truncate"><strong className={player.mark === 'X' ? 'text-red-500' : 'text-sky-500'}>{player.mark}</strong> · {player.id === sessionId ? 'You' : player.handle}</span>)}</div>
      <p role="status" className="mb-4 text-center font-semibold">{game.result === 'draw' ? 'Draw — well played!' : winner ? `${winner.handle} wins!` : you?.mark === game.turn ? 'Your turn' : `${turn?.handle}'s turn`}</p>
      <div role="group" aria-label="Tic Tac Toe board" className="mx-auto grid w-full max-w-[340px] grid-cols-3 gap-2">
        {game.board.map((mark, square) => <button key={square} type="button" aria-label={`Square ${square + 1}: ${mark ?? 'empty'}`} disabled={busy || !!game.result || !!mark || you?.mark !== game.turn} onClick={() => void send({ action: 'move', gameId: game.id, round: game.round, revision: state.revision, square })} className={`aspect-square rounded-lg border text-5xl font-bold transition-colors motion-reduce:transition-none ${game.winningLine.includes(square) ? 'border-emerald-500 bg-emerald-500/15' : 'border-stone-300 bg-white enabled:hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:enabled:hover:bg-stone-800'} ${mark === 'X' ? 'text-red-500' : 'text-sky-500'}`}>{mark}</button>)}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
      {game.result && <button type="button" disabled={busy || game.rematch.includes(sessionId)} onClick={() => void send({ action: 'rematch', gameId: game.id, round: game.round })} className="mt-5 w-full rounded-lg bg-[var(--chat-accent)] py-3 font-semibold text-white disabled:opacity-60">{game.rematch.includes(sessionId) ? 'Waiting for your peer…' : game.rematch.length ? 'Accept rematch' : 'Request rematch'}</button>}
      <p className="mt-4 text-center text-xs text-stone-500 dark:text-stone-400">Shared live with {peerHandle}. Minimize to keep chatting.</p>
    </dialog>}
  </>;
});
