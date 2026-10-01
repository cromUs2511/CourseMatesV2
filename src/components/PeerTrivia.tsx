import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Minimize2, Clock, Trophy, RotateCw } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import type {
  TriviaState,
  TriviaAction,
  TriviaCategory,
  TriviaQuestion,
  PeerGameActivity,
} from '../data/peerGames';
import { GameInvitation } from './GameInvitation';
import { LeaveGameButton, LeftGameNotice } from './GameLeave';
import { usePeerGameActivity } from './usePeerGameActivity';

export type PeerTriviaHandle = { open: () => void };

const CATEGORY_LABELS: Record<TriviaCategory, string> = {
  general: 'General Knowledge',
  science: 'Science',
  technology: 'Technology',
  gaming: 'Gaming',
  movies: 'Movies',
  music: 'Music',
  history: 'History',
  random: 'Random',
};

export const PeerTrivia = forwardRef<
  PeerTriviaHandle,
  {
    roomId: string;
    sessionId: string;
    peerHandle: string;
    ws?: WebSocket;
    onActivity?: (activity: PeerGameActivity | null) => void;
  }
>(function PeerTrivia({ roomId, sessionId, peerHandle, ws, onActivity }, ref) {
  const [state, setState] = useState<TriviaState>({
    revision: -1,
    game: null,
    invitation: null,
    leftBy: null,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCategorySelect, setShowCategorySelect] = useState(false);
  const sending = useRef(false);
  const seenRound = useRef('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const timerRef = useRef<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const apply = useCallback((next: TriviaState) => {
    setState((current) => (next.revision > current.revision ? next : current));
  }, []);
  // Fast sync while inviting or playing; slow safety net when idle.
  const isLive = !!(state.invitation || (state.game && state.game.phase !== 'game-end'));
  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await apiRequest<TriviaState>(
          '/api/chat/trivia?roomId=' + encodeURIComponent(roomId),
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
        if (data.type === 'trivia_state' && data.roomId === roomId) apply(data.state);
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
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (game && game.phase === 'answering') {
      const updateTimer = () => {
        const remaining = Math.max(0, Math.ceil((game.timerEndsAt - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining === 0) clearInterval(timerRef.current!);
      };
      updateTimer();
      timerRef.current = window.setInterval(updateTimer, 500);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [game?.phase, game?.timerEndsAt]);
  useEffect(() => {
    if (game?.phase === 'revealing' || game?.phase === 'round-end' || game?.phase === 'game-end') {
      playChime('match');
    }
  }, [game?.phase]);
  const send = async (action: TriviaAction) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      apply(await apiRequest<TriviaState>('/api/chat/trivia', { roomId, ...action }));
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
      else if (!state.invitation) {
        setShowCategorySelect(true);
      }
    },
  }));
  const you = game?.players.find((player) => player.id === sessionId);
  const opponent = game?.players.find((player) => player.id !== sessionId);
  const yourScore = game?.scores?.[sessionId] ?? 0;
  const oppScore = opponent ? (game?.scores?.[opponent.id] ?? 0) : 0;
  const currentQuestion = game?.questions[game?.currentQuestionIndex ?? 0];
  const yourAnswer = game?.answers?.[sessionId];
  const oppAnswer = opponent ? game?.answers?.[opponent.id] : null;
  const bothAnswered = !!yourAnswer && !!oppAnswer;
  const triviaActivity = state.invitation
    ? {
        status: state.invitation.fromId === sessionId ? 'Invitation sent' : 'Invitation received',
        incoming: state.invitation.fromId !== sessionId,
      }
    : game && game.phase !== 'game-end'
      ? {
          status: `Question ${game.currentQuestionIndex + 1} of ${game.questions.length}`,
          incoming: false,
        }
      : null;
  usePeerGameActivity(onActivity, 'trivia', 'Trivia', triviaActivity);
  const handleCategorySelect = (category: TriviaCategory) => {
    setShowCategorySelect(false);
    void send({ action: 'invite', category });
  };
  if (showCategorySelect && !game) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <div className="bg-stone-900 rounded-2xl p-6 w-full max-w-md">
          <h3 className="mb-4 text-lg font-bold text-white">Choose Trivia Category</h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => handleCategorySelect(value as TriviaCategory)}
                className="p-3 rounded-xl border border-stone-700 bg-stone-800 text-white text-left hover:bg-stone-700"
              >
                <span className="font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowCategorySelect(false)}
            className="mt-4 w-full rounded-lg border border-stone-600 py-2 text-sm font-semibold text-stone-300"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      {state.invitation && (
        <GameInvitation
          game="Trivia"
          sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle}
          incoming={state.invitation.fromId !== sessionId}
          busy={busy}
          onRespond={(accept) =>
            void send({ action: 'respond', invitationId: state.invitation!.id, accept })
          }
        />
      )}
      {!game && !state.invitation && (
        <LeftGameNotice leftBy={state.leftBy} sessionId={sessionId} gameLabel="Trivia" />
      )}
      {error && !open && (
        <p role="alert" className="mx-auto max-w-3xl py-2 text-sm text-red-500">
          {error}
        </p>
      )}
      {open && game && (
        <dialog
          ref={dialogRef}
          aria-label="Trivia"
          onCancel={() => setOpen(false)}
          className="m-auto max-h-[var(--app-height,100dvh)] w-full max-w-lg overflow-y-auto border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 backdrop:bg-black/70 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100 sm:rounded-xl"
        >
          <header className="flex items-center justify-between border-b border-stone-300 pb-4 dark:border-stone-700">
            <div>
              <h2 className="text-lg font-bold">Trivia</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Chat 1v1 · {CATEGORY_LABELS[game.category]} · Question{' '}
                {game.currentQuestionIndex + 1} of {game.questions.length}
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
                aria-label="Minimize Trivia"
                onClick={() => setOpen(false)}
                className="rounded-lg p-3 hover:bg-stone-500/10"
              >
                <Minimize2 className="h-5 w-5" />
              </button>
            </div>
          </header>
          <div className="my-4 flex justify-between gap-4 text-sm">
            {game.players.map((player) => (
              <span key={player.id} className="min-w-0 truncate">
                <strong className={player.id === sessionId ? 'text-stone-900 dark:text-white' : ''}>
                  {player.id === sessionId ? 'You' : player.handle}
                </strong>
                : {game.scores?.[player.id] ?? 0} pts
              </span>
            ))}
          </div>
          {(game.phase === 'waiting' || game.phase === 'answering') && currentQuestion && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <p role="status" className="font-semibold text-center flex-1" aria-live="polite">
                  {game.phase === 'answering' ? 'Answer the question!' : 'Waiting for opponent…'}
                </p>
                <div className="flex items-center gap-1.5 text-sm font-mono text-amber-600 dark:text-amber-400">
                  <Clock className="h-4 w-4" /> {timeLeft}s
                </div>
              </div>
              <p className="text-lg font-semibold text-center">{currentQuestion.question}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {currentQuestion.options.map((option, index) => {
                  const isYourAnswer = yourAnswer?.answerIndex === index;
                  const isOppAnswer = oppAnswer?.answerIndex === index;
                  const isCorrect = index === currentQuestion.correctIndex;
                  const showResult =
                    game.phase === 'revealing' ||
                    game.phase === 'round-end' ||
                    game.phase === 'game-end';
                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={busy || yourAnswer !== undefined || game.phase !== 'answering'}
                      onClick={() =>
                        void send({
                          action: 'answer',
                          gameId: game.id,
                          round: game.round,
                          revision: state.revision,
                          answerIndex: index,
                        })
                      }
                      className={`trivia-option p-3 rounded-xl border-2 text-left transition-colors motion-reduce:transition-none ${showResult ? (isCorrect ? 'border-emerald-500 bg-emerald-500/15' : isYourAnswer ? 'border-red-500 bg-red-500/15' : 'border-stone-300 bg-stone-50') : 'border-stone-300 bg-white enabled:hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:enabled:hover:bg-stone-800'}`}
                      aria-label={`Option ${String.fromCharCode(65 + index)}: ${option}`}
                    >
                      <span className="mr-2 font-bold text-stone-700 dark:text-stone-300">
                        {String.fromCharCode(65 + index)}.
                      </span>
                      <span className="flex-1">{option}</span>
                      {showResult && isCorrect && (
                        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                      )}
                      {showResult && isYourAnswer && !isCorrect && (
                        <span className="text-red-600 dark:text-red-400">✗</span>
                      )}
                      {showResult && isOppAnswer && !isCorrect && (
                        <span className="text-stone-500">✗</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {yourAnswer !== undefined && game.phase === 'answering' && (
                <p className="text-center text-sm text-stone-500 dark:text-stone-400">
                  Waiting for opponent…
                </p>
              )}
            </div>
          )}
          {(game.phase === 'revealing' ||
            game.phase === 'round-end' ||
            game.phase === 'game-end') &&
            currentQuestion && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-stone-100 dark:bg-stone-900">
                  <p className="text-sm font-semibold">
                    Correct answer:{' '}
                    <span className="font-normal text-emerald-700 dark:text-emerald-300">
                      {currentQuestion.options[currentQuestion.correctIndex]}
                    </span>
                  </p>
                  <p className="text-sm">
                    You:{' '}
                    {yourAnswer !== undefined
                      ? currentQuestion.options[yourAnswer.answerIndex]
                      : 'No answer'}
                  </p>
                  <p className="text-sm">
                    Opponent:{' '}
                    {oppAnswer != null
                      ? currentQuestion.options[oppAnswer.answerIndex]
                      : 'No answer'}
                  </p>
                </div>
                {game.phase === 'game-end' && game.result && (
                  <div className="text-center space-y-2">
                    <p className="text-lg font-bold">
                      {game.result.winnerId === sessionId
                        ? '🎉 You win!'
                        : game.result.winnerId
                          ? `${game.players.find((p) => p.id === game.result!.winnerId)?.handle} wins!`
                          : 'Draw!'}
                    </p>
                    <p className="text-sm">
                      Final Score — You: {game.result.finalScores[sessionId]} — Opponent:{' '}
                      {opponent ? game.result.finalScores[opponent.id] : 0}
                    </p>
                  </div>
                )}
                {game.phase === 'revealing' && (
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
                    className="w-full rounded-lg bg-[var(--chat-accent)] py-3 font-semibold text-white disabled:opacity-60"
                  >
                    Next Question
                  </button>
                )}
              </div>
            )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-500">
              {error}
            </p>
          )}
          {(game.phase === 'round-end' || game.phase === 'game-end') && game.result && (
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
