import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Minimize2, Paintbrush, Eraser, Undo2, Trash2, Palette, Trophy, Clock } from 'lucide-react';
import {
  DRAW_CATEGORIES,
  DRAW_DIFFICULTIES,
  DRAW_COLORS,
  type DrawCategory,
  type DrawDifficulty,
  type DrawGuessState,
  type DrawGuessAction,
} from '../data/drawGuess';
import type { PeerGameActivity } from '../data/peerGames';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import { DrawingCanvas } from './DrawingCanvas';
import { GameInvitation } from './GameInvitation';
import { LeaveGameButton } from './GameLeave';
import { usePeerGameActivity } from './usePeerGameActivity';
import '../drawing.css';

export type PeerDrawGuessHandle = { open: () => void };
export const PeerDrawGuess = forwardRef<
  PeerDrawGuessHandle,
  {
    roomId: string;
    sessionId: string;
    peerHandle: string;
    ws?: WebSocket;
    onActivity?: (activity: PeerGameActivity | null) => void;
  }
>(function PeerDrawGuess({ roomId, sessionId, peerHandle, ws, onActivity }, ref) {
  const [state, setState] = useState<DrawGuessState>({
    revision: -1,
    invitation: null,
    game: null,
    leftBy: null,
  });
  const [open, setOpen] = useState(false),
    [setup, setSetup] = useState(false);
  const [category, setCategory] = useState<DrawCategory>('all'),
    [difficulty, setDifficulty] = useState<DrawDifficulty>('mixed');
  const [color, setColor] = useState<string>(DRAW_COLORS[0]),
    [width, setWidth] = useState(5),
    [eraser, setEraser] = useState(false);
  const [guess, setGuess] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [socketOpen, setSocketOpen] = useState(ws?.readyState === WebSocket.OPEN);
  const dialog = useRef<HTMLDialogElement>(null),
    seen = useRef('');
  const mounted = useRef(true),
    queue = useRef<Promise<void>>(Promise.resolve()),
    lastStrokeAt = useRef(0);
  const clockOffset = useRef(0);
  const syncingRef = useRef(syncing);
  syncingRef.current = syncing;
  const apply = useCallback((next: DrawGuessState) => {
    if (typeof next.serverNow === 'number') clockOffset.current = next.serverNow - Date.now();
    if (mounted.current) setState((current) => (next.revision > current.revision ? next : current));
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const live = !!(state.invitation || (state.game && !state.game.result));
  useEffect(() => {
    const update = () => setSocketOpen(ws?.readyState === WebSocket.OPEN);
    update();
    ws?.addEventListener('open', update);
    ws?.addEventListener('close', update);
    return () => {
      ws?.removeEventListener('open', update);
      ws?.removeEventListener('close', update);
    };
  }, [ws]);
  useEffect(() => {
    let disposed = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await apiRequest<DrawGuessState>(
          '/api/chat/drawing?roomId=' + encodeURIComponent(roomId),
        );
        if (!disposed) apply(next);
      } catch {
        /* Next poll recovers socket loss. */
      } finally {
        polling = false;
      }
    };
    const receive = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'drawing_state' && data.roomId === roomId) apply(data.state);
      } catch {
        /* REST recovers malformed events. */
      }
    };
    ws?.addEventListener('message', receive);
    void poll();
    const timer = window.setInterval(poll, live ? 1000 : socketOpen ? 10000 : 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      ws?.removeEventListener('message', receive);
    };
  }, [apply, live, socketOpen, roomId, ws]);
  const send = useCallback(
    (action: DrawGuessAction): Promise<void> => {
      const work = queue.current.then(async () => {
        if (!mounted.current) throw new Error('Chat closed.');
        if (action.action === 'stroke') {
          const wait = Math.max(0, 250 - (Date.now() - lastStrokeAt.current));
          if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
          if (!mounted.current) throw new Error('Chat closed.');
          lastStrokeAt.current = Date.now();
        } else {
          setBusy(true);
          setError('');
        }
        try {
          apply(await apiRequest<DrawGuessState>('/api/chat/drawing', { roomId, ...action }));
        } catch (err) {
          if (mounted.current) {
            setError(
              action.action === 'stroke'
                ? `Sketch could not sync: ${(err as Error).message} Reopen or continue after reconnecting.`
                : (err as Error).message,
            );
            try {
              apply(
                await apiRequest<DrawGuessState>(
                  '/api/chat/drawing?roomId=' + encodeURIComponent(roomId),
                ),
              );
            } catch {
              /* Keep visible error. */
            }
          }
          throw err;
        } finally {
          if (mounted.current && action.action !== 'stroke') setBusy(false);
        }
      });
      queue.current = work.catch(() => {});
      return work;
    },
    [apply, roomId],
  );
  const act = (action: DrawGuessAction) => {
    void send(action).catch(() => {});
  };
  const game = state.game;
  useEffect(() => {
    if (!game) {
      setOpen(false);
      return;
    }
    const key = game.id;
    if (seen.current !== key) {
      seen.current = key;
      setSetup(false);
      setOpen(true);
    }
  }, [game]);
  useEffect(() => {
    setGuess('');
    setEraser(false);
    setSyncing(false);
  }, [game?.id, game?.round]);
  useEffect(() => {
    if (!open && !setup) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current!;
    el.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      if (syncingRef.current) return;
      setOpen(false);
      setSetup(false);
    };
    el.addEventListener('cancel', cancel);
    return () => {
      el.removeEventListener('cancel', cancel);
      el.close();
      previous?.focus({ preventScroll: true });
    };
  }, [open, setup]);
  useEffect(() => {
    if (!game) return;
    const update = () =>
      setTimeLeft(
        Math.max(0, Math.ceil((game.deadline - Date.now() - clockOffset.current) / 1000)),
      );
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [game?.deadline]);
  useEffect(() => {
    if (game?.phase === 'reveal' || game?.phase === 'finished') playChime('match');
  }, [game?.phase]);
  useImperativeHandle(ref, () => ({
    open: () => {
      if (game) setOpen(true);
      else if (!state.invitation) setSetup(true);
    },
  }));
  usePeerGameActivity(
    onActivity,
    'drawing',
    'Draw & Guess',
    state.invitation
      ? {
          status: state.invitation.fromId === sessionId ? 'Invitation sent' : 'Invitation received',
          incoming: state.invitation.fromId !== sessionId,
        }
      : game && !game.result
        ? {
            status: `Round ${game.round} of 6 · ${game.phase === 'choosing' ? 'Choosing a word' : game.phase === 'drawing' ? 'Drawing' : 'Answer revealed'}`,
            incoming: false,
          }
        : null,
  );
  const drawer = game?.drawerId === sessionId;
  const drawing = game?.phase === 'drawing';
  const revealed = game?.phase === 'reveal' || game?.phase === 'finished';
  const turn = game ? { gameId: game.id, round: game.round } : null;
  const opponent = game?.players.find((p) => p.id !== sessionId);
  return (
    <>
      {state.invitation && (
        <GameInvitation
          game="Draw & Guess"
          sender={state.invitation.fromId === sessionId ? peerHandle : state.invitation.fromHandle}
          incoming={state.invitation.fromId !== sessionId}
          busy={busy}
          onRespond={(accept) =>
            act({ action: 'respond', invitationId: state.invitation!.id, accept })
          }
        />
      )}
      {/* Game-leave events now live in the message timeline as system messages. */}
      {error && !open && !setup && (
        <p role="alert" className="draw-inline-error">
          {error}
        </p>
      )}
      {(open || setup) && (
        <dialog ref={dialog} aria-labelledby="draw-title" className="draw-dialog">
          <header className="draw-header">
            <div className="draw-heading">
              <span className="draw-icon">
                <Palette size={24} aria-hidden="true" />
              </span>
              <div>
                <h2 id="draw-title">Draw & Guess</h2>
                <p>
                  {game
                    ? `Round ${game.round} / 6 · ${drawer ? 'Your drawing turn' : `${game.players.find((p) => p.id === game.drawerId)?.handle} is drawing`}`
                    : 'A little sketch. A lot of possibilities.'}
                </p>
              </div>
            </div>
            <div className="draw-header-actions">
              {game && (
                <LeaveGameButton
                  gameId={game.id}
                  busy={busy || syncing}
                  label="Leave Draw & Guess"
                  onLeave={() => act({ action: 'leave' })}
                />
              )}
              <button
                type="button"
                aria-label="Minimize Draw & Guess"
                disabled={syncing}
                onClick={() => {
                  setOpen(false);
                  setSetup(false);
                }}
              >
                <Minimize2 size={20} />
              </button>
            </div>
          </header>
          {error && (
            <p role="alert" className="draw-error">
              {error}
            </p>
          )}
          {setup && !game ? (
            <div className="draw-setup">
              <div className="draw-setup-art" aria-hidden="true">
                ✏️
              </div>
              <h3>Make your next conversation a masterpiece.</h3>
              <p>
                Take turns sketching and guessing. Pick from 1,100 original ideas, from animals to
                campus chaos.
              </p>
              <div className="draw-filters">
                <label>
                  Prompt category
                  <select
                    aria-label="Prompt category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DrawCategory)}
                  >
                    {Object.entries(DRAW_CATEGORIES).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prompt difficulty
                  <select
                    aria-label="Prompt difficulty"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as DrawDifficulty)}
                  >
                    {Object.entries(DRAW_DIFFICULTIES).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="draw-rules">
                6 rounds · 60 seconds to draw · 3 words to choose from
                <br />
                No spelling the word on the canvas. Clever sketches encouraged.
              </p>
              <button
                className="draw-primary"
                type="button"
                disabled={busy}
                onClick={() => {
                  void send({ action: 'invite', category, difficulty })
                    .then(() => setSetup(false))
                    .catch(() => {});
                }}
              >
                Invite peer to draw
              </button>
            </div>
          ) : (
            game && (
              <>
                <div className="draw-scorebar">
                  <span className="draw-score">
                    <Trophy size={16} aria-hidden="true" /> You{' '}
                    <strong>{game.scores[sessionId] ?? 0}</strong>
                  </span>
                  <span
                    className={`draw-clock ${timeLeft <= 10 && drawing ? 'draw-clock-low' : ''}`}
                  >
                    <Clock size={16} aria-hidden="true" />
                    {revealed ? 'Round complete' : `${timeLeft}s`}
                  </span>
                  <span className="draw-score draw-peer-score">
                    <span title={opponent?.handle}>{opponent?.handle}</span>
                    <strong>{opponent ? game.scores[opponent.id] : 0}</strong>
                  </span>
                </div>
                {game.phase === 'choosing' ? (
                  <section className="draw-choices">
                    <span className="draw-eyebrow">
                      {drawer ? 'Your secret prompt' : 'Get ready to guess'}
                    </span>
                    <h3>{drawer ? 'What will you draw?' : 'Your peer is choosing a word…'}</h3>
                    <p>
                      {drawer
                        ? 'Pick one. Only you can see these ideas.'
                        : 'Watch their sketch, then type your guesses below.'}
                    </p>
                    {drawer && (
                      <div className="draw-choice-grid">
                        {game.choices.map((choice) => (
                          <button
                            type="button"
                            data-draw-choice={choice.word}
                            key={choice.id}
                            disabled={busy}
                            onClick={() => act({ action: 'choose', ...turn!, choiceId: choice.id })}
                          >
                            <span>{choice.word}</span>
                            <small>
                              {DRAW_CATEGORIES[choice.category]} · {choice.difficulty}
                            </small>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                ) : (
                  <>
                    <div className="draw-prompt">
                      <span className="draw-eyebrow">
                        {game.promptCategory} · {drawer ? 'Draw this' : 'Guess this'}
                      </span>
                      {drawer || revealed ? (
                        <strong data-secret-word>{game.word}</strong>
                      ) : (
                        <strong className="draw-word-mask" aria-label={`Word hint: ${game.hint}`}>
                          {game.hint}
                        </strong>
                      )}
                    </div>
                    {drawer && drawing && (
                      <div className="draw-toolbar" aria-label="Drawing tools">
                        <div className="draw-palette">
                          {DRAW_COLORS.map((c) => (
                            <button
                              type="button"
                              key={c}
                              aria-label={`Color ${c}`}
                              aria-pressed={color === c && !eraser}
                              disabled={syncing}
                              style={{ '--swatch': c } as React.CSSProperties}
                              onClick={() => {
                                setColor(c);
                                setEraser(false);
                              }}
                            >
                              <span />
                            </button>
                          ))}
                        </div>
                        <div className="draw-tool-row">
                          <button
                            type="button"
                            aria-label="Brush"
                            aria-pressed={!eraser}
                            disabled={syncing}
                            onClick={() => setEraser(false)}
                          >
                            <Paintbrush size={18} />
                          </button>
                          <button
                            type="button"
                            aria-label="Eraser"
                            aria-pressed={eraser}
                            disabled={syncing}
                            onClick={() => setEraser(true)}
                          >
                            <Eraser size={18} />
                          </button>
                          <label className="draw-brush-label">
                            Size
                            <select
                              aria-label="Brush size"
                              value={width}
                              disabled={syncing}
                              onChange={(e) => setWidth(Number(e.target.value))}
                            >
                              <option value={3}>Fine</option>
                              <option value={5}>Medium</option>
                              <option value={10}>Bold</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            aria-label="Undo last stroke"
                            disabled={busy || syncing || !game.strokes.length}
                            onClick={() =>
                              act({ action: 'undo', ...turn!, canvasVersion: game.canvasVersion })
                            }
                          >
                            <Undo2 size={18} />
                          </button>
                          <button
                            type="button"
                            aria-label="Clear canvas"
                            disabled={busy || syncing || !game.strokes.length}
                            onClick={() =>
                              act({ action: 'clear', ...turn!, canvasVersion: game.canvasVersion })
                            }
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    )}
                    <DrawingCanvas
                      key={`${game.id}:${game.round}`}
                      strokes={game.strokes}
                      canvasVersion={game.canvasVersion}
                      enabled={drawer && drawing}
                      color={color}
                      width={width}
                      eraser={eraser}
                      onSyncChange={setSyncing}
                      onBatch={(batch) => send({ action: 'stroke', ...turn!, ...batch })}
                    />
                    <p className="draw-canvas-note">
                      {syncing
                        ? 'Syncing your sketch…'
                        : drawer && drawing
                          ? 'Draw with your finger, mouse, or pen.'
                          : drawing
                            ? 'Every stroke is a clue.'
                            : 'Your shared masterpiece.'}
                    </p>
                    {!drawer && drawing && (
                      <form
                        className="draw-guess-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (guess.trim())
                            void send({ action: 'guess', ...turn!, text: guess })
                              .then(() => setGuess(''))
                              .catch(() => {});
                        }}
                      >
                        <input
                          aria-label="Your guess"
                          placeholder="What could it be?"
                          value={guess}
                          maxLength={80}
                          autoComplete="off"
                          enterKeyHint="send"
                          onChange={(e) => setGuess(e.target.value)}
                        />
                        <button
                          type="submit"
                          className="draw-primary"
                          aria-label="Send guess"
                          disabled={busy || !guess.trim()}
                        >
                          Guess
                        </button>
                      </form>
                    )}
                    {game.guesses.length > 0 && (
                      <div className="draw-guesses" aria-label="Guesses">
                        {game.guesses.slice(-5).map((g) => (
                          <span key={g.id} className={g.correct ? 'draw-guess-correct' : ''}>
                            {g.text}
                            {g.correct ? ' ✓' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {revealed && (
                      <section className="draw-result">
                        <p role="status">
                          {game.solved
                            ? 'Correct guess! Nice teamwork.'
                            : 'Time’s up! The word was'}{' '}
                          {!game.solved && <strong>{game.word}</strong>}
                        </p>
                        {game.phase === 'finished' ? (
                          <>
                            <h3>
                              {game.result?.winnerId
                                ? `${game.players.find((p) => p.id === game.result!.winnerId)?.handle} wins!`
                                : 'A perfect tie!'}
                            </h3>
                            <p>Six sketches later. Ready for another masterpiece?</p>
                            <button
                              className="draw-primary"
                              type="button"
                              disabled={busy || game.rematch.includes(sessionId)}
                              onClick={() => act({ action: 'rematch', ...turn! })}
                            >
                              {game.rematch.includes(sessionId)
                                ? 'Waiting for peer…'
                                : game.rematch.length
                                  ? 'Accept rematch'
                                  : 'Request rematch'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="draw-primary"
                            disabled={busy}
                            onClick={() => act({ action: 'next', ...turn! })}
                          >
                            Next round
                          </button>
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            )
          )}
        </dialog>
      )}
    </>
  );
});
