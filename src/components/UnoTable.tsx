import React, { useEffect, useState } from 'react';
import { Ban, BookOpen, Crown, Loader2, Minimize2, RotateCw, X } from 'lucide-react';
import type { UnoAction, UnoCard, UnoColor, UnoValue, UnoViewerState } from '../../unoTypes';
import { UNO_COLORS } from '../../unoTypes';
import { playChime } from '../utils/sound';
import '../uno.css';

const CORNER_LABEL: Partial<Record<UnoValue, string>> = {
  skip: '⦸',
  reverse: '↻',
  wild: 'W',
  'wild+4': '+4',
};

const COLOR_TEXT: Record<UnoColor, string> = {
  red: 'text-red-400',
  blue: 'text-sky-400',
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
};

function cardOvalContent(value: UnoValue): React.ReactNode {
  if (value === 'skip') return <Ban className="h-6 w-6 text-slate-900 md:h-7 md:w-7" />;
  if (value === 'reverse') return <RotateCw className="h-6 w-6 text-slate-900 md:h-7 md:w-7" />;
  if (value === 'wild')
    return (
      <span className="grid h-6 w-6 grid-cols-2 gap-1" aria-hidden="true">
        <span className="rounded-sm bg-red-500" />
        <span className="rounded-sm bg-sky-500" />
        <span className="rounded-sm bg-amber-400" />
        <span className="rounded-sm bg-emerald-500" />
      </span>
    );
  return (
    <span className="text-xl font-black tracking-tight text-slate-900 md:text-2xl">{value}</span>
  );
}

export function UnoCardFace({
  card,
  playable = false,
  className = '',
  label,
  onPlay,
}: {
  card: UnoCard;
  playable?: boolean;
  className?: string;
  label?: string;
  onPlay?: () => void;
}) {
  const corner = CORNER_LABEL[card.value] ?? card.value;
  const face = (
    <div
      className={`uno-card c-${card.color} ${playable ? 'playable' : ''} ${className}`}
      data-card-id={card.id}
      data-card-value={card.value}
      data-card-color={card.color}
    >
      <span className="corner-tag corner-tl">{corner}</span>
      <span className="card-oval">{cardOvalContent(card.value)}</span>
      <span className="corner-tag corner-br">{corner}</span>
    </div>
  );
  if (!onPlay) return face;
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={label || `${card.color} ${card.value}`}
      className="touch-manipulation rounded-xl focus-visible:outline-2 focus-visible:outline-yellow-400"
    >
      {face}
    </button>
  );
}

function OpponentBox({ state, variant }: { state: UnoViewerState; variant: 'top' }) {
  const yourTurn = state.turn === 'you' && state.status === 'playing';
  const fanCount = Math.min(state.opponent.handCount, 6);
  return (
    <div
      className={`uno-opponent flex flex-col items-center rounded-xl border bg-slate-900/70 px-4 py-1.5 shadow-lg backdrop-blur transition-all ${
        yourTurn ? 'border-slate-600' : 'border-emerald-500/60 bg-emerald-950/40'
      } ${variant === 'top' ? '' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            yourTurn ? 'bg-slate-500' : 'animate-ping motion-reduce:animate-none bg-emerald-400'
          }`}
          aria-hidden="true"
        />
        <span className="max-w-[140px] truncate text-xs font-bold text-slate-200 md:text-sm">
          {state.opponent.handle}
        </span>
        <span className="rounded-full border border-red-500/30 bg-red-900/60 px-2 py-0.5 text-xs font-black text-red-300">
          {state.opponent.handCount} card{state.opponent.handCount === 1 ? '' : 's'}
        </span>
        {state.opponent.calledUno && state.opponent.handCount === 1 && (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black uppercase text-yellow-300">
            UNO!
          </span>
        )}
      </div>
      <div className="uno-fan mt-1.5 flex h-12 items-center justify-center -space-x-4 overflow-hidden md:h-14">
        {Array.from({ length: fanCount }, (_, index) => (
          <div
            key={index}
            className="card-back h-9 w-6 flex-shrink-0 rounded border border-white/30 shadow md:h-12 md:w-8"
          />
        ))}
      </div>
    </div>
  );
}

export type UnoTableProps = {
  state: UnoViewerState;
  busy?: boolean;
  error?: string;
  onAction: (action: UnoAction) => void;
  onLeave: () => void;
  onClose?: () => void;
};

export function UnoTable({ state, busy, error, onAction, onLeave, onClose }: UnoTableProps) {
  const [pendingWild, setPendingWild] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const yourTurn = state.turn === 'you' && state.status === 'playing';
  const gameOver = state.status === 'over';

  useEffect(() => {
    if (gameOver) playChime('match');
  }, [gameOver]);

  const playCard = (card: UnoCard) => {
    if (!yourTurn || busy || !state.playable.includes(card.id)) return;
    if (card.color === 'black') {
      setPendingWild(card.id);
      return;
    }
    playChime('click');
    onAction({ action: 'play', gameId: state.gameId, cardId: card.id });
  };

  const pickColor = (color: UnoColor) => {
    if (!pendingWild) return;
    playChime('click');
    onAction({ action: 'play', gameId: state.gameId, cardId: pendingWild, color });
    setPendingWild(null);
  };

  return (
    <div className="uno-table uno-felt relative flex h-full w-full flex-col overflow-hidden text-slate-100">
      {/* Status strip */}
      <header className="uno-bar z-30 flex w-full items-center justify-between gap-2 border-b border-emerald-900/40 bg-black/40 px-3 py-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <span className="skew-x-6 border-2 border-yellow-400 bg-red-600 px-2.5 py-1 font-black tracking-wider text-white shadow-md">
            UNO!
          </span>
          <span className="hidden text-xs font-semibold uppercase tracking-widest text-emerald-300 sm:inline">
            {state.source === 'arena' ? 'Arena 1v1' : 'Chat 1v1'}
          </span>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="min-w-0 flex-1 truncate rounded-full border border-emerald-500/30 bg-slate-900/80 px-3 py-1 text-center text-xs font-bold text-emerald-300"
        >
          {error ? <span className="text-red-300">{error}</span> : state.notice}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            aria-label="UNO rules"
            title="Rules"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700 md:h-8 md:w-8"
          >
            <BookOpen className="h-4 w-4" />
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={() => onClose()}
              aria-label="Minimize the UNO table"
              title="Back to chat"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700 md:h-8 md:w-8"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              aria-label="Leave the UNO table"
              title="Leave the table"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700 md:h-8 md:w-8"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <main className="uno-stage relative flex min-h-0 flex-1 flex-col items-center justify-between overflow-hidden p-2 md:p-4">
        {/* Direction of play ring */}
        <div
          className={`uno-ring absolute h-64 w-64 md:h-80 md:w-80 ${
            state.direction === 1 ? 'uno-dir-cw' : 'uno-dir-ccw'
          }`}
          aria-hidden="true"
        >
          <span className="uno-ring-arrow arrow-top">▲</span>
          <span className="uno-ring-arrow arrow-bottom">▼</span>
          <span className="uno-ring-arrow arrow-left">◀</span>
          <span className="uno-ring-arrow arrow-right">▶</span>
        </div>

        {/* Opponent */}
        <div className="relative z-10 flex w-full justify-center">
          <OpponentBox state={state} variant="top" />
        </div>

        {/* Arena centre */}
        <div className="uno-centre relative z-10 flex w-full flex-1 flex-col items-center justify-center gap-3">
          <div className="uno-colour flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-4 py-1 backdrop-blur-sm">
            <span className="text-xs uppercase tracking-wider text-slate-300">Active colour:</span>
            <span
              className={`h-4 w-4 scale-110 rounded-full shadow-md c-${state.activeColor}`}
              aria-hidden="true"
            />
            <span className={`text-xs font-black uppercase ${COLOR_TEXT[state.activeColor]}`}>
              {state.activeColor}
            </span>
          </div>

          <div className="flex items-center justify-center gap-6 md:gap-10">
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => {
                  if (!yourTurn || busy || state.hasDrawn) return;
                  playChime('click');
                  onAction({ action: 'draw', gameId: state.gameId });
                }}
                disabled={!yourTurn || busy || state.hasDrawn}
                title="Draw a card"
                aria-label="Draw a card from the deck"
                className="group relative transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="uno-deck-shadow absolute -left-1 -top-1 h-[108px] w-[72px] -rotate-3 rounded-xl bg-slate-700 card-back md:h-[128px] md:w-[86px]" />
                <div className="uno-card card-back relative flex flex-col items-center justify-center border-2 border-white/40 transition group-hover:border-yellow-400 group-hover:scale-105 group-enabled:group-hover:scale-105">
                  <span className="card-back-oval">
                    <span className="tracking-tighter text-yellow-300 drop-shadow md:text-lg">
                      UNO
                    </span>
                  </span>
                  <span className="absolute bottom-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    Draw
                  </span>
                </div>
              </button>
              <span className="uno-pile-label mt-1 text-[11px] font-bold text-emerald-300/80">
                Deck: {state.deckCount}
              </span>
            </div>

            <div className="flex flex-col items-center">
              <div className="relative flex items-center justify-center">
                <UnoCardFace
                  key={state.top.id}
                  card={state.top}
                  className="uno-deal-in pointer-events-none scale-105 shadow-2xl"
                  label={`Discard pile: ${state.top.color} ${state.top.value}`}
                />
              </div>
              <span className="uno-pile-label mt-1 text-[11px] font-bold text-slate-400">
                Discard pile
              </span>
            </div>
          </div>

          <div className="uno-turnrow flex h-8 items-center justify-center gap-2">
            {yourTurn && state.hasDrawn && !busy && (
              <button
                type="button"
                onClick={() => onAction({ action: 'pass', gameId: state.gameId })}
                className="uno-pass rounded-full border border-amber-500/50 bg-amber-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-amber-500 md:px-4 md:py-1 md:text-xs"
              >
                Pass turn
              </button>
            )}
            {busy && (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none text-emerald-300"
                aria-label="Sending"
              />
            )}
          </div>
        </div>

        {/* Your side */}
        <div className="uno-mine relative z-20 flex w-full flex-col items-center pb-2">
          <div className="uno-callrow mb-1.5 flex w-full max-w-4xl items-center justify-between gap-3 px-3">
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-slate-900/80 px-3 py-1">
              <span
                className={`h-3 w-3 rounded-full ${yourTurn ? 'bg-emerald-400' : 'bg-slate-600'}`}
                aria-hidden="true"
              />
              <span className="text-xs font-bold text-slate-100">You</span>
              <span className="ml-1 rounded bg-emerald-950/80 px-2 py-0.5 text-xs font-black text-emerald-400">
                {state.you.hand.length} card{state.you.hand.length === 1 ? '' : 's'}
              </span>
              {state.you.calledUno && state.you.hand.length === 1 && (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black uppercase text-yellow-300">
                  UNO!
                </span>
              )}
            </div>
            {yourTurn && (
              <p
                role="status"
                className="uno-turn-indicator rounded-full border-2 border-slate-950/60 bg-amber-400 px-4 py-1.5 text-sm font-black uppercase tracking-wide text-slate-950 shadow-lg"
              >
                Your turn!
              </p>
            )}
          </div>

          <div className="uno-hand uno-no-scrollbar flex w-full max-w-5xl justify-center overflow-x-auto px-4 py-2">
            <div className="flex min-w-max items-center justify-start -space-x-5 px-6 md:-space-x-7 md:justify-center">
              {state.you.hand.map((card, index) => {
                const playable = yourTurn && state.playable.includes(card.id) && !busy;
                return (
                  <div
                    key={card.id}
                    className="uno-hand-card transition-transform duration-200"
                    style={{ zIndex: index, animationDelay: `${Math.min(index, 8) * 30}ms` }}
                  >
                    <UnoCardFace
                      card={card}
                      playable={playable}
                      onPlay={playable ? () => playCard(card) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Wild colour chooser */}
      {pendingWild && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose a wild colour"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-2xl border-2 border-white/20 bg-slate-900 p-6 text-center shadow-2xl">
            <h3 className="mb-1 text-xl font-black uppercase tracking-wider text-white">
              Choose wild colour
            </h3>
            <p className="mb-5 text-xs text-slate-400">
              Pick the colour the next player has to match.
            </p>
            <div className="grid grid-cols-2 gap-4">
              {UNO_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => pickColor(color)}
                  className={`c-${color} flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-white/30 font-black text-white shadow-lg transition hover:scale-105`}
                >
                  <span className="h-6 w-6 rounded-full bg-white shadow" />
                  <span className="text-sm uppercase">{color}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPendingWild(null)}
              className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rules */}
      {rulesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="UNO rules"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 text-left">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-black uppercase text-white">
                <BookOpen className="h-4 w-4 text-emerald-400" /> Rules
              </h3>
              <button
                type="button"
                onClick={() => setRulesOpen(false)}
                aria-label="Close rules"
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs leading-relaxed text-slate-300">
              <p>
                <strong>Goal:</strong> be the first to get rid of all your cards.
              </p>
              <p>
                <strong>Match</strong> the discard pile by colour, number or symbol.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>Skip:</strong> the next player loses their turn.
                </li>
                <li>
                  <strong>Reverse:</strong> flips play order — in 1v1 it acts as a Skip.
                </li>
                <li>
                  <strong>+2:</strong> the next player draws 2 and is skipped.
                </li>
                <li>
                  <strong>Wild:</strong> play any time and choose the colour.
                </li>
                <li>
                  <strong>Wild +4:</strong> choose the colour; the next player draws 4.
                </li>
              </ul>
              <p>
                <strong>UNO:</strong> the call is automatic — playing your second-to-last card
                announces it for you.
              </p>
              <p>
                <strong>Draw:</strong> once per turn you may draw; then play a card or pass.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Leaving mid-game (arena) */}
      {confirmLeave && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Leave the game?"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
            <h3 className="mb-2 text-lg font-black uppercase tracking-wider text-white">
              Leave the game?
            </h3>
            <p className="mb-5 text-xs leading-relaxed text-slate-400">
              Your opponent wins the table if you walk away now.
            </p>
            <div className="space-y-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmLeave(false)}
                className="w-full rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-slate-700"
              >
                Stay at the table
              </button>
              <button
                type="button"
                onClick={() => onLeave()}
                className="w-full rounded-xl border border-red-500/40 bg-red-950/60 py-2.5 text-sm font-bold text-red-300 transition hover:bg-red-900/60"
              >
                Leave table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Game result"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
            <div
              className={`mb-3 flex justify-center ${
                state.winner === 'you' ? 'text-amber-400' : 'text-red-400'
              }`}
            >
              <Crown className="h-10 w-10" />
            </div>
            <h2
              className={`mb-2 text-2xl font-black tracking-wide ${
                state.winner === 'you' ? 'text-amber-400' : 'text-red-400'
              }`}
            >
              {state.winner === 'you'
                ? 'Victory!'
                : state.winner === 'opponent'
                  ? 'Defeated'
                  : 'Game over'}
            </h2>
            <p className="mb-6 text-sm text-slate-300">{state.notice}</p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={onLeave}
                autoFocus
                className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white shadow-sm transition hover:bg-emerald-500"
              >
                Leave table
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-slate-700"
                >
                  Back to chat
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
