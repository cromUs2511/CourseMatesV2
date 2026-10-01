import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Minimize2, RotateCw, X } from 'lucide-react';
import { apiRequest } from '../utils/api';
import type { RpsState, RpsAction, RpsChoice } from '../data/peerGames';
import { GameInvitation } from './GameInvitation';

export type PeerRpsHandle = { open: () => void };

export const PeerRockPaperScissors = forwardRef<PeerRpsHandle, {
  roomId: string; sessionId: string; peerHandle: string; ws?: WebSocket;
}>(function PeerRockPaperScissors({ roomId, sessionId, peerHandle, ws }, ref) {
  const [state, setState] = useState<RpsState>({ revision: -1, game: null, invitation: null });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const seenRound = useRef('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const apply = useCallback((next: RpsState) => {
    setState((current) => next.revision > current.revision ? next : current);
  }, []);
  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await apiRequest<RpsState>('/api/chat/rps?roomId=' + encodeURIComponent(roomId));
        if (!disposed) apply(next);
      } catch { /* REST retries recover a dropped socket. */ }
      finally { polling = false; }
    };
    const receive = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'rps_state' && data.roomId === roomId) apply(data.state);
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
  const send = async (action: RpsAction) => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { apply(await apiRequest<RpsState>('/api/chat/rps', { roomId, ...action })); }
    catch (err) { setError((err as Error).message); }
    finally { sending.current = false; setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ open: () => {
    if (game) setOpen(true);
    else if (!state.invitation) void send({ action: 'invite' });
  } }));
  const you = game?.players.find((player) => player.id === sessionId);
  const opponent = game?.players.find((player) => player.id !== sessionId);
  const youChoice = game?.choices?.[sessionId];
  const oppChoice = opponent ? game?.choices?.[opponent.id] : null;
  const bothChosen = !!youChoice && !!oppChoice;
  const roundOver = game?.turn === 'revealing' || game?.turn === 'round-end';
  const gameOver = game?.turn === 'round-end' && game.result?.winnerId !== null;
  return <>
    {state.invitation && <GameInvitation game="Rock Paper Scissors" sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle} incoming={state.invitation.fromId !== sessionId} busy={busy} onRespond={(accept) => void send({ action: 'respond', invitationId: state.invitation!.id, accept })} />}
    {error && !open && <p role="alert" className="mx-auto max-w-3xl py-2 text-sm text-red-500">{error}</p>}
    {open && game && <dialog ref={dialogRef} aria-label="Rock Paper Scissors" onCancel={() => setOpen(false)} className="m-auto max-h-[var(--app-height,100dvh)] w-full max-w-lg overflow-y-auto border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 backdrop:bg-black/70 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100 sm:rounded-xl">
      <header className="flex items-center justify-between border-b border-stone-300 pb-4 dark:border-stone-700">
        <div><h2 className="text-lg font-bold">Rock Paper Scissors</h2><p className="text-xs text-stone-500 dark:text-stone-400">Chat 1v1 · Best of {game.bestOf} · Round {game.round}</p></div>
        <button type="button" aria-label="Minimize Rock Paper Scissors" onClick={() => setOpen(false)} className="rounded-lg p-3 hover:bg-stone-500/10"><Minimize2 className="h-5 w-5" /></button>
      </header>
      <div className="my-4 flex justify-between gap-4 text-sm">
        {game.players.map((player) => <span key={player.id} className="min-w-0 truncate"><strong className={player.id === sessionId ? 'text-stone-900 dark:text-white' : ''}>{player.id === sessionId ? 'You' : player.handle}</strong></span>)}
      </div>
      <p role="status" className="mb-4 text-center font-semibold">
        {gameOver
          ? game.result?.winnerId === sessionId
            ? 'You win the match!'
            : game.result?.winnerId
              ? `${game.players.find(p => p.id === game.result!.winnerId)?.handle} wins the match!`
              : 'Match drawn!'
          : roundOver
            ? game.result?.reason ?? 'Round over!'
            : game.turn === 'choosing' && !youChoice
              ? 'Your turn to choose'
              : game.turn === 'choosing' && youChoice
                ? 'Waiting for opponent…'
                : 'Revealing…'}
      </p>
      <div className="flex flex-col gap-4">
        <div className="flex justify-center gap-6">
          {game.players.map((player) => {
            const isYou = player.id === sessionId;
            const choice = game.choices?.[player.id];
            const showChoice = roundOver || (isYou && choice);
            return (
              <div key={player.id} className="flex flex-col items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{isYou ? 'You' : player.handle}</span>
                <div className="flex items-center justify-center gap-2">
                  {(['rock', 'paper', 'scissors'] as const).map((c: RpsChoice) => (
                    <button
                      key={c}
                      type="button"
                      disabled={busy || !!game.result || (isYou && !!choice) || !isYou || game.turn !== 'choosing'}
                      onClick={() => void send({ action: 'choose', gameId: game.id, round: game.round, revision: state.revision, choice: c })}
                      className={`rps-btn flex flex-col items-center gap-1 rounded-xl border-2 p-3 transition-colors motion-reduce:transition-none ${isYou && choice === c ? 'border-amber-400 bg-amber-400/15' : isYou ? 'border-stone-300 bg-white enabled:hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:enabled:hover:bg-stone-800' : 'border-stone-200 bg-stone-50 dark:border-stone-800'} ${showChoice && choice === c ? 'rps-chosen' : ''}`}
                      aria-label={c}
                    >
                      {c === 'rock' && <span className="text-3xl">🪨</span>}
                      {c === 'paper' && <span className="text-3xl">📄</span>}
                      {c === 'scissors' && <span className="text-3xl">✂️</span>}
                      <span className="text-xs font-bold capitalize text-stone-700 dark:text-stone-300">{c}</span>
                    </button>
                  ))}
                </div>
                {showChoice && choice && (
                  <div className="rps-reveal flex flex-col items-center gap-1 animate-pulse motion-reduce:animate-none">
                    {choice === 'rock' && <span className="text-4xl">🪨</span>}
                    {choice === 'paper' && <span className="text-4xl">📄</span>}
                    {choice === 'scissors' && <span className="text-4xl">✂️</span>}
                    <span className="text-sm font-bold capitalize text-stone-700 dark:text-stone-300">{choice}</span>
                  </div>
                )}
                {roundOver && !showChoice && <span className="text-xs text-stone-400">Hidden</span>}
              </div>
            );
          })}
        </div>
        {gameOver && game.result && (
          <div className="text-center space-y-2">
            <p className="text-sm text-stone-600 dark:text-stone-400">{game.result.reason}</p>
            <p className="text-lg font-bold">
              Score: {game.players.map(p => `${p.id === sessionId ? 'You' : p.handle}: ${game.scores[p.id]}`).join(' — ')}
            </p>
            <button type="button" disabled={busy || game.rematch.includes(sessionId)} onClick={() => void send({ action: 'rematch', gameId: game.id, round: game.round })} className="mx-auto rounded-lg bg-[var(--chat-accent)] px-6 py-2 font-semibold text-white disabled:opacity-60">
              {game.rematch.includes(sessionId) ? 'Waiting for your peer…' : game.rematch.length ? 'Accept rematch' : 'Request rematch'}
            </button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
      <p className="mt-4 text-center text-xs text-stone-500 dark:text-stone-400">Shared live with {peerHandle}. Minimize to keep chatting.</p>
    </dialog>}
  </>;
});