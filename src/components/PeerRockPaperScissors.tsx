import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Minimize2 } from 'lucide-react';
import { apiRequest } from '../utils/api';
import type { RpsState, RpsAction, RpsChoice, PeerGameActivity } from '../data/peerGames';
import { GameInvitation } from './GameInvitation';
import { LeaveGameButton, LeftGameNotice } from './GameLeave';
import { usePeerGameActivity } from './usePeerGameActivity';

export type PeerRpsHandle = { open: () => void };

const MOVES: { choice: RpsChoice; emoji: string; keyHint: string }[] = [
  { choice: 'rock', emoji: '🪨', keyHint: 'R' },
  { choice: 'paper', emoji: '📄', keyHint: 'P' },
  { choice: 'scissors', emoji: '✂️', keyHint: 'S' },
];

export const PeerRockPaperScissors = forwardRef<
  PeerRpsHandle,
  {
    roomId: string;
    sessionId: string;
    peerHandle: string;
    ws?: WebSocket;
    onActivity?: (activity: PeerGameActivity | null) => void;
  }
>(function PeerRockPaperScissors({ roomId, sessionId, peerHandle, ws, onActivity }, ref) {
  const [state, setState] = useState<RpsState>({
    revision: -1,
    game: null,
    invitation: null,
    leftBy: null,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealIn, setRevealIn] = useState<number | null>(null);
  const sending = useRef(false);
  const seenRound = useRef('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply = useCallback((next: RpsState) => {
    setState((current) => (next.revision > current.revision ? next : current));
  }, []);
  // Fast sync while inviting or playing; slow safety net when idle.
  const isLive = !!(state.invitation || (state.game && state.game.turn !== 'round-end'));
  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await apiRequest<RpsState>(
          '/api/chat/rps?roomId=' + encodeURIComponent(roomId),
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
        if (data.type === 'rps_state' && data.roomId === roomId) apply(data.state);
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
  const gameOver = game?.turn === 'round-end';
  // Short reveal countdown once both choices lock; skipped for reduced motion.
  useEffect(() => {
    if (game?.turn !== 'revealing' || gameOver) {
      setRevealIn(null);
      return;
    }
    if (reduceMotion) return;
    setRevealIn(3);
    const timers = [
      window.setTimeout(() => setRevealIn(2), 600),
      window.setTimeout(() => setRevealIn(1), 1200),
      window.setTimeout(() => setRevealIn(null), 1800),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [game?.turn, game?.round, game?.id, gameOver, reduceMotion]);
  const send = async (action: RpsAction) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      apply(await apiRequest<RpsState>('/api/chat/rps', { roomId, ...action }));
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
  const youChoice = game?.choices?.[sessionId];
  const opponent = game?.players.find((player) => player.id !== sessionId);
  const oppChoice = opponent ? game?.choices?.[opponent.id] : undefined;
  const peerLocked = opponent ? (game?.locked.includes(opponent.id) ?? false) : false;
  const revealed = !!game && game.turn === 'revealing' && revealIn === null;
  const showOpp = !!game && (revealed || !!gameOver) && !!oppChoice;
  const roundWinner = showOpp ? (game!.result?.winnerId ?? null) : null;
  const youWinRound = roundWinner === sessionId;
  const peerWinRound = !!opponent && roundWinner === opponent.id;
  const roundDraw = showOpp && roundWinner === null;
  const draws = game?.draws ?? 0;
  const youScore = game ? (game.scores[sessionId] ?? 0) : 0;
  const peerScore = opponent && game ? (game.scores[opponent.id] ?? 0) : 0;
  const choose = (choice: RpsChoice) => {
    if (!game || game.turn !== 'choosing' || youChoice || busy || game.result) return;
    void send({
      action: 'choose',
      gameId: game.id,
      round: game.round,
      revision: state.revision,
      choice,
    });
  };
  const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const key = event.key.toLowerCase();
    const move = MOVES.find((entry) => entry.keyHint.toLowerCase() === key);
    if (move) {
      event.preventDefault();
      choose(move.choice);
    }
  };
  const rpsActivity = state.invitation
    ? {
        status: state.invitation.fromId === sessionId ? 'Invitation sent' : 'Invitation received',
        incoming: state.invitation.fromId !== sessionId,
      }
    : game && game.turn !== 'round-end'
      ? {
          status:
            game.turn === 'choosing'
              ? youChoice
                ? `Round ${game.round} · Waiting for opponent…`
                : `Round ${game.round} · Your turn to choose`
              : `Round ${game.round} · Revealing…`,
          incoming: false,
        }
      : null;
  usePeerGameActivity(onActivity, 'rps', 'Rock Paper Scissors', rpsActivity);
  const statusText = !game
    ? ''
    : game.turn === 'choosing'
      ? youChoice
        ? `Waiting for ${opponent?.handle ?? 'peer'}…`
        : 'Choose your move'
      : game.turn === 'revealing'
        ? revealIn !== null
          ? `Revealing in ${revealIn}…`
          : (game.result?.reason ?? 'Revealing…')
        : game.result?.winnerId === sessionId
          ? 'You win the match!'
          : game.result?.winnerId
            ? `${game.players.find((p) => p.id === game.result!.winnerId)?.handle} wins the match!`
            : 'Match drawn!';
  return (
    <>
      {state.invitation && (
        <GameInvitation
          game="Rock Paper Scissors"
          sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle}
          incoming={state.invitation.fromId !== sessionId}
          busy={busy}
          onRespond={(accept) =>
            void send({ action: 'respond', invitationId: state.invitation!.id, accept })
          }
        />
      )}
      {!game && !state.invitation && (
        <LeftGameNotice
          leftBy={state.leftBy}
          sessionId={sessionId}
          gameLabel="Rock Paper Scissors"
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
          aria-label="Rock Paper Scissors"
          onCancel={() => setOpen(false)}
          onKeyDown={onDialogKeyDown}
          className="m-auto max-h-[var(--app-height,100dvh)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-stone-300 bg-[#faf8f5] p-4 text-stone-900 shadow-2xl backdrop:bg-black/65 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100 sm:p-5"
        >
          <header className="flex items-center justify-between gap-2 border-b border-stone-300 pb-3 dark:border-stone-700">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold sm:text-lg">Rock Paper Scissors</h2>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 sm:text-xs">
                Chat 1v1 · Best of {game.bestOf} · First to {Math.ceil(game.bestOf / 2)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <LeaveGameButton
                gameId={game.id}
                busy={busy}
                onLeave={() => void send({ action: 'leave' })}
              />
              <button
                type="button"
                aria-label="Minimize Rock Paper Scissors"
                title="Minimize"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2.5 hover:bg-stone-500/10"
              >
                <Minimize2 className="h-5 w-5" />
              </button>
            </div>
          </header>

          {/* Scoreboard */}
          <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-stone-300 bg-white/60 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900/50 sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-lg sm:h-10 sm:w-10"
              >
                👤
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 sm:text-[11px]">
                  You
                </span>
                <span className="block text-xl font-black leading-none sm:text-2xl">
                  {youScore}
                </span>
              </span>
            </div>
            <div className="shrink-0 text-center">
              <span className="inline-block rounded-full bg-stone-200 px-2.5 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300 sm:text-[11px]">
                Draws: {draws}
              </span>
              <p
                role="status"
                aria-live="polite"
                className="mt-1 text-[11px] font-semibold sm:text-xs"
              >
                {statusText}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <span className="min-w-0 text-right">
                <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 sm:text-[11px]">
                  {opponent?.handle ?? 'Peer'}
                </span>
                <span className="block text-xl font-black leading-none sm:text-2xl">
                  {peerScore}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-lg sm:h-10 sm:w-10"
              >
                {(opponent?.handle ?? '?').charAt(0).toUpperCase()}
              </span>
            </div>
          </div>

          {/* Arena */}
          <div className="mt-3 flex items-stretch gap-2 sm:gap-3">
            <div
              className={`min-w-0 flex-1 rounded-2xl border-2 p-3 text-center transition-colors sm:p-5 ${
                youWinRound
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : roundDraw && showOpp
                    ? 'border-amber-400 bg-amber-400/10'
                    : youChoice
                      ? 'border-teal-500/70 bg-teal-500/5'
                      : 'border-stone-300 dark:border-stone-700'
              }`}
            >
              <div aria-hidden="true" className="text-5xl sm:text-6xl">
                {youChoice ? MOVES.find((m) => m.choice === youChoice)?.emoji : '?'}
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-400 sm:text-xs">
                {youChoice ? 'Ready' : 'Choose'}
              </p>
            </div>
            <div className="flex shrink-0 items-center">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-[10px] font-black text-stone-500 dark:border-stone-600 dark:text-stone-300 sm:h-11 sm:w-11 sm:text-xs"
              >
                {revealIn ?? 'VS'}
              </span>
            </div>
            <div
              className={`min-w-0 flex-1 rounded-2xl border-2 p-3 text-center transition-colors sm:p-5 ${
                peerWinRound
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : roundDraw && showOpp
                    ? 'border-amber-400 bg-amber-400/10'
                    : showOpp
                      ? 'border-rose-500/70 bg-rose-500/5'
                      : 'border-stone-300 dark:border-stone-700'
              }`}
            >
              <div aria-hidden="true" className="text-5xl sm:text-6xl">
                {showOpp && oppChoice ? MOVES.find((m) => m.choice === oppChoice)?.emoji : '?'}
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-400 sm:text-xs">
                {showOpp ? 'Revealed' : peerLocked ? 'Ready' : 'Waiting'}
              </p>
            </div>
          </div>

          {/* Move cards */}
          {game.turn === 'choosing' && (
            <div
              className="mt-3 grid grid-cols-3 gap-2 sm:gap-3"
              role="group"
              aria-label="Choose your move"
            >
              {MOVES.map((move) => {
                const selected = youChoice === move.choice;
                return (
                  <button
                    key={move.choice}
                    type="button"
                    onClick={() => choose(move.choice)}
                    disabled={busy || !!youChoice || !!game.result}
                    aria-label={`${move.choice} (shortcut ${move.keyHint})`}
                    className={`flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-2xl border-2 p-2 transition-colors disabled:cursor-default sm:min-h-[104px] ${
                      selected
                        ? 'border-teal-500 bg-teal-500/10'
                        : 'border-stone-300 bg-white enabled:hover:border-teal-500/60 dark:border-stone-700 dark:bg-stone-900 dark:enabled:hover:border-teal-500/60'
                    }`}
                  >
                    <span aria-hidden="true" className="text-3xl sm:text-4xl">
                      {move.emoji}
                    </span>
                    <span className="text-xs font-bold capitalize sm:text-sm">{move.choice}</span>
                    <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      Key {move.keyHint}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Round result / next / rematch */}
          {game.turn === 'revealing' && revealed && game.result && (
            <div className="mt-3 space-y-2 text-center">
              <p className="text-sm font-bold">{game.result.reason}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void send({
                    action: 'next',
                    gameId: game.id,
                    round: game.round,
                    revision: state.revision,
                  })
                }
                className="w-full rounded-xl bg-[var(--chat-accent)] py-3 text-sm font-bold text-white disabled:opacity-60"
              >
                Next Round
              </button>
            </div>
          )}
          {gameOver && game.result && (
            <div className="mt-3 space-y-2 text-center">
              <p className="text-sm text-stone-600 dark:text-stone-400">{game.result.reason}</p>
              <p className="text-lg font-black">
                You {youScore} — {draws} draws — {peerScore} {opponent?.handle ?? 'Peer'}
              </p>
              <button
                type="button"
                disabled={busy || game.rematch.includes(sessionId)}
                onClick={() => void send({ action: 'rematch', gameId: game.id, round: game.round })}
                className="w-full rounded-xl bg-[var(--chat-accent)] py-3 text-sm font-bold text-white disabled:opacity-60"
              >
                {game.rematch.includes(sessionId)
                  ? 'Waiting for your peer…'
                  : game.rematch.length
                    ? 'Accept rematch'
                    : 'Request rematch'}
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-center text-sm text-red-500">
              {error}
            </p>
          )}
          <p className="mt-3 text-center text-xs text-stone-500 dark:text-stone-400">
            Shared live with {peerHandle}. Minimize to keep chatting.
          </p>
        </dialog>
      )}
    </>
  );
});
