import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Minimize2, MessageSquare, RotateCw, Heart } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import type { WyrState, WyrAction, WyrQuestion } from '../data/peerGames';
import { GameInvitation } from './GameInvitation';

export type PeerWouldYouRatherHandle = { open: () => void };

const CATEGORIES = ['Funny', 'Random', 'Gaming', 'School', 'Technology', 'Difficult Choices'];

export const PeerWouldYouRather = forwardRef<PeerWouldYouRatherHandle, {
  roomId: string; sessionId: string; peerHandle: string; ws?: WebSocket;
}>(function PeerWouldYouRather({ roomId, sessionId, peerHandle, ws }, ref) {
  const [state, setState] = useState<WyrState>({ revision: -1, game: null, invitation: null });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCategorySelect, setShowCategorySelect] = useState(false);
  const sending = useRef(false);
  const seenRound = useRef('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const apply = useCallback((next: WyrState) => {
    setState((current) => next.revision > current.revision ? next : current);
  }, []);
  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await apiRequest<WyrState>('/api/chat/wyr?roomId=' + encodeURIComponent(roomId));
        if (!disposed) apply(next);
      } catch { /* REST retries recover a dropped socket. */ }
      finally { polling = false; }
    };
    const receive = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'wyr_state' && data.roomId === roomId) apply(data.state);
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
  useEffect(() => {
    if (game?.phase === 'revealing') playChime('match');
  }, [game?.phase]);
  const send = async (action: WyrAction) => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { apply(await apiRequest<WyrState>('/api/chat/wyr', { roomId, ...action })); }
    catch (err) { setError((err as Error).message); }
    finally { sending.current = false; setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ open: () => {
    if (game) setOpen(true);
    else if (!state.invitation) { setShowCategorySelect(true); }
  } }));
  const you = game?.players.find((player) => player.id === sessionId);
  const opponent = game?.players.find((player) => player.id !== sessionId);
  const currentQuestion = game?.questions[game?.currentQuestionIndex ?? 0];
  const yourChoice = game?.choices?.[sessionId];
  const oppChoice = opponent ? game?.choices?.[opponent.id] : null;
  const bothChosen = !!yourChoice && !!oppChoice;
  const handleCategorySelect = (category: string) => {
    setShowCategorySelect(false);
    void send({ action: 'invite', category });
  };
  if (showCategorySelect && !game) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <div className="bg-stone-900 rounded-2xl p-6 w-full max-w-md">
          <h3 className="mb-4 text-lg font-bold text-white">Choose Category</h3>
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((cat) => (
              <button key={cat} type="button" onClick={() => handleCategorySelect(cat)} className="p-3 rounded-xl border border-stone-700 bg-stone-800 text-white text-left hover:bg-stone-700">
                {cat}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowCategorySelect(false)} className="mt-4 w-full rounded-lg border border-stone-600 py-2 text-sm font-semibold text-stone-300">Cancel</button>
        </div>
      </div>
    );
  }
  return <>
    {state.invitation && <GameInvitation game="Would You Rather" sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle} incoming={state.invitation.fromId !== sessionId} busy={busy} onRespond={(accept) => void send({ action: 'respond', invitationId: state.invitation!.id, accept })} />}
    {error && !open && <p role="alert" className="mx-auto max-w-3xl py-2 text-sm text-red-500">{error}</p>}
    {open && game && <dialog ref={dialogRef} aria-label="Would You Rather" onCancel={() => setOpen(false)} className="m-auto max-h-[var(--app-height,100dvh)] w-full max-w-lg overflow-y-auto border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 backdrop:bg-black/70 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100 sm:rounded-xl">
      <header className="flex items-center justify-between border-b border-stone-300 pb-4 dark:border-stone-700">
        <div><h2 className="text-lg font-bold">Would You Rather</h2><p className="text-xs text-stone-500 dark:text-stone-400">Chat 1v1 · {game.category} · Question {game.currentQuestionIndex + 1} of {game.questions.length}</p></div>
        <button type="button" aria-label="Minimize Would You Rather" onClick={() => setOpen(false)} className="rounded-lg p-3 hover:bg-stone-500/10"><Minimize2 className="h-5 w-5" /></button>
      </header>
      <div className="my-4 flex justify-between gap-4 text-sm">
        {game.players.map((player) => <span key={player.id} className="min-w-0 truncate"><strong className={player.id === sessionId ? 'text-stone-900 dark:text-white' : ''}>{player.id === sessionId ? 'You' : player.handle}</strong></span>)}
      </div>
      {(game.phase === 'waiting' || game.phase === 'choosing') && currentQuestion && (
        <div className="space-y-4">
          <p role="status" className="font-semibold text-center" aria-live="polite">
            {game.phase === 'choosing' && !yourChoice ? 'Make your choice!' : 'Waiting for opponent…'}
          </p>
          <div className="p-6 rounded-2xl bg-stone-100 dark:bg-stone-900 text-center">
            <p className="text-lg font-semibold mb-4">{currentQuestion.text}</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={busy || yourChoice !== undefined || game.phase !== 'choosing'}
                onClick={() => void send({ action: 'choose', gameId: game.id, round: game.round, revision: state.revision, choice: 'A' })}
                className={`wyr-option p-4 rounded-xl border-2 text-left transition-colors motion-reduce:transition-none ${yourChoice === 'A' ? 'border-amber-400 bg-amber-400/15' : 'border-stone-300 bg-white enabled:hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:enabled:hover:bg-stone-800'}`}
              >
                <span className="font-bold text-lg mr-2">A.</span>
                <span>{currentQuestion.optionA}</span>
              </button>
              <button
                type="button"
                disabled={busy || yourChoice !== undefined || game.phase !== 'choosing'}
                onClick={() => void send({ action: 'choose', gameId: game.id, round: game.round, revision: state.revision, choice: 'B' })}
                className={`wyr-option p-4 rounded-xl border-2 text-left transition-colors motion-reduce:transition-none ${yourChoice === 'B' ? 'border-amber-400 bg-amber-400/15' : 'border-stone-300 bg-white enabled:hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:enabled:hover:bg-stone-800'}`}
              >
                <span className="font-bold text-lg mr-2">B.</span>
                <span>{currentQuestion.optionB}</span>
              </button>
            </div>
            {yourChoice && game.phase === 'choosing' && <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">Waiting for {opponent?.handle}…</p>}
          </div>
        </div>
      )}
      {(game.phase === 'revealing' || game.phase === 'round-end') && currentQuestion && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-stone-100 dark:bg-stone-900">
            <p className="font-semibold mb-2">{currentQuestion.text}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className={`p-3 rounded-xl text-center ${yourChoice === 'A' ? 'bg-amber-400/20 border-2 border-amber-400' : 'bg-stone-200 dark:bg-stone-800'}`}>
                <p className="text-sm font-bold text-stone-500 dark:text-stone-400">You</p>
                <p className="font-semibold">{currentQuestion.optionA}</p>
              </div>
              <div className={`p-3 rounded-xl text-center ${oppChoice === 'A' ? 'bg-amber-400/20 border-2 border-amber-400' : 'bg-stone-200 dark:bg-stone-800'}`}>
                <p className="text-sm font-bold text-stone-500 dark:text-stone-400">{opponent?.handle}</p>
                <p className="font-semibold">{currentQuestion.optionA}</p>
              </div>
              <div className={`p-3 rounded-xl text-center ${yourChoice === 'B' ? 'bg-amber-400/20 border-2 border-amber-400' : 'bg-stone-200 dark:bg-stone-800'}`}>
                <p className="text-sm font-bold text-stone-500 dark:text-stone-400">You</p>
                <p className="font-semibold">{currentQuestion.optionB}</p>
              </div>
              <div className={`p-3 rounded-xl text-center ${oppChoice === 'B' ? 'bg-amber-400/20 border-2 border-amber-400' : 'bg-stone-200 dark:bg-stone-800'}`}>
                <p className="text-sm font-bold text-stone-500 dark:text-stone-400">{opponent?.handle}</p>
                <p className="font-semibold">{currentQuestion.optionB}</p>
              </div>
            </div>
            <p className="mt-3 text-center font-semibold text-lg" aria-live="polite">
              {game.result?.sameChoice ? '🎉 Same choice!' : 'Different choices!'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void send({ action: 'next', gameId: game.id, round: game.round, revision: state.revision })}
              className="flex-1 rounded-lg bg-[var(--chat-accent)] py-3 font-semibold text-white"
            >
              Next Question
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-stone-400 px-4 py-3 font-semibold dark:border-stone-600"
            >
              Discuss in Chat
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
      {game.phase === 'round-end' && game.result && (
        <button type="button" disabled={busy || game.rematch.includes(sessionId)} onClick={() => void send({ action: 'rematch', gameId: game.id, round: game.round })} className="mt-5 w-full rounded-lg bg-[var(--chat-accent)] py-3 font-semibold text-white disabled:opacity-60">
          {game.rematch.includes(sessionId) ? 'Waiting for your peer…' : game.rematch.length ? 'Accept rematch' : 'Request rematch'}
        </button>
      )}
      <p className="mt-4 text-center text-xs text-stone-500 dark:text-stone-400">Shared live with {peerHandle}. Minimize to keep chatting.</p>
    </dialog>}
  </>;
});