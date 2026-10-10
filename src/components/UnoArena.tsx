import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Loader2, ShieldCheck, Swords, Users } from 'lucide-react';
import type { UnoAction, UnoStateResponse, UnoTableSize } from '../../unoTypes';
import { apiRequest } from '../utils/api';
import { UnoLogo } from './GameLogos';
import { UnoTable } from './UnoTable';
import '../uno.css';

const ARENA_POLL_MS = 1200;
const BOT_OFFER_AFTER_MS = 5;

type OpponentChoice = 'players' | 'bots';

export type UnoArenaProps = {
  isDarkMode: boolean;
  onBack: () => void;
  onPlayingChange?: (playing: boolean) => void;
};

const SIZE_OPTIONS: { value: UnoTableSize; label: string; description: string }[] = [
  { value: 2, label: 'Classic 1v1', description: 'Two seats, fastest to start' },
  { value: 4, label: 'Four players', description: 'A full table, last hand standing' },
];

const OPPONENT_OPTIONS: { value: OpponentChoice; label: string; description: string }[] = [
  { value: 'players', label: 'Real players', description: 'Match with students who are online' },
  { value: 'bots', label: 'Bots', description: 'Start now — the house fills the empty seats' },
];

export function UnoArena({ isDarkMode, onBack, onPlayingChange }: UnoArenaProps) {
  const [state, setState] = useState<UnoStateResponse | null>(null);
  const [size, setSize] = useState<UnoTableSize>(2);
  const [opponents, setOpponents] = useState<OpponentChoice>('players');
  const [searching, setSearching] = useState(false);
  const [queueTime, setQueueTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchingRef = useRef(false);
  const mountedRef = useRef(true);

  // A slow poll must not overwrite the newer state a move just returned.
  const applyState = useCallback((next: UnoStateResponse) => {
    setState((current) => ((next.revision ?? 0) >= (current?.revision ?? 0) ? next : current));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await apiRequest<UnoStateResponse>('/api/uno/state');
      if (!mountedRef.current) return;
      applyState(data);
      if (data.game || !data.queued) {
        setSearching(false);
        searchingRef.current = false;
      }
    } catch {
      /* Polling failures are retried on the next tick. */
    }
  }, [applyState]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = setInterval(() => void refresh(), ARENA_POLL_MS);
    const timer = setInterval(() => setQueueTime((value) => value + 1), 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [refresh]);

  const startSearch = async (request?: { size: UnoTableSize; opponents: OpponentChoice }) => {
    const tableSize = request?.size ?? size;
    const seatWith = request?.opponents ?? opponents;
    if (request) {
      setSize(request.size);
      setOpponents(request.opponents);
    }
    setError('');
    setBusy(true);
    try {
      await apiRequest('/api/uno/arena', { size: tableSize, opponents: seatWith });
      const withBots = seatWith === 'bots';
      searchingRef.current = !withBots;
      setSearching(!withBots);
      setQueueTime(0);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelSearch = async () => {
    searchingRef.current = false;
    setSearching(false);
    try {
      await apiRequest('/api/uno/arena/cancel', {});
    } catch {
      /* The server expires abandoned lobby seats anyway. */
    }
    await refresh();
  };

  const sendAction = async (action: UnoAction) => {
    setBusy(true);
    setError('');
    try {
      const data = await apiRequest<UnoStateResponse>('/api/uno/action', action);
      applyState(data);
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const leaveTable = async () => {
    setBusy(true);
    try {
      await apiRequest('/api/uno/leave', {});
    } catch {
      /* Leaving is best effort; the server drops idle tables. */
    }
    setBusy(false);
    setState(null);
    await refresh();
  };

  const inGame = !!state?.game;
  const showBotOffer = searching && queueTime >= BOT_OFFER_AFTER_MS;

  useEffect(() => {
    onPlayingChange?.(inGame);
  }, [inGame, onPlayingChange]);

  const startLabel =
    opponents === 'bots'
      ? size === 4
        ? 'Play a four-player bot table'
        : 'Play the bots'
      : size === 4
        ? 'Find a four-player table'
        : 'Find an opponent';

  return (
    <div
      className={`ambient-grid flex-1 min-h-0 w-full h-full flex flex-col overflow-hidden ${
        isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800'
      }`}
    >
      {!inGame && (
        <div className="uno-arena-bar flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 md:py-1.5 md:text-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to menu
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            UNO Arena · 1v1 or four players
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {inGame && state?.game ? (
          <UnoTable
            state={state.game}
            busy={busy}
            error={error || undefined}
            onAction={(action) => void sendAction(action)}
            onLeave={() => void leaveTable()}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto px-4 py-6">
            <div className="w-full max-w-md space-y-4">
              <div className="ui-surface rounded-2xl p-6 space-y-5">
                <div className="flex flex-col items-center text-center">
                  <UnoLogo className="h-20 w-20 -rotate-6" />
                  <h2 className="mt-4 text-xl font-bold tracking-tight text-stone-900 dark:text-white">
                    UNO Arena
                  </h2>
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    Pick your table, then choose who fills the other seats — students online right
                    now, or bots when nobody is free.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Table size
                  </p>
                  <div
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                    role="radiogroup"
                    aria-label="Table size"
                  >
                    {SIZE_OPTIONS.map((option) => {
                      const selected = size === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={searching || busy}
                          onClick={() => setSize(option.value)}
                          className={`rounded-xl border p-3 text-left transition-colors ${
                            selected
                              ? 'chat-theme-accent-soft border-current'
                              : 'border-stone-200 bg-white/60 text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-200 dark:hover:bg-stone-800'
                          }`}
                        >
                          <span className="block text-sm font-bold">{option.label}</span>
                          <span className="mt-0.5 block text-xs font-normal">
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Who joins the table
                  </p>
                  <div
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                    role="radiogroup"
                    aria-label="Who joins the table"
                  >
                    {OPPONENT_OPTIONS.map((option) => {
                      const selected = opponents === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={searching || busy}
                          onClick={() => setOpponents(option.value)}
                          className={`rounded-xl border p-3 text-left transition-colors ${
                            selected
                              ? 'chat-theme-accent-soft border-current'
                              : 'border-stone-200 bg-white/60 text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-200 dark:hover:bg-stone-800'
                          }`}
                        >
                          <span className="flex items-center gap-2 text-sm font-bold">
                            {option.value === 'bots' ? (
                              <Bot className="h-3.5 w-3.5" />
                            ) : (
                              <Users className="h-3.5 w-3.5" />
                            )}
                            {option.label}
                          </span>
                          <span className="mt-0.5 block text-xs font-normal">
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {error && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}

                {!searching ? (
                  <button
                    type="button"
                    onClick={() => void startSearch()}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 py-3.5 text-sm font-bold text-white transition-colors hover:bg-stone-700 disabled:opacity-60 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    ) : opponents === 'bots' ? (
                      <Bot className="h-4 w-4" />
                    ) : (
                      <Swords className="h-4 w-4" />
                    )}
                    {startLabel}
                  </button>
                ) : (
                  <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-5 dark:border-stone-700 dark:bg-stone-900/60">
                    <div className="flex items-center justify-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-200">
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      {size === 4
                        ? 'Waiting for three more players…'
                        : 'Waiting for another player…'}{' '}
                      ({queueTime}s)
                    </div>
                    <div className="h-1.5 w-full overflow-hidden bg-stone-200 dark:bg-stone-800">
                      <div
                        className="h-full bg-stone-900 transition-all duration-300 motion-reduce:transition-none dark:bg-white"
                        style={{ width: `${Math.min(100, (queueTime % 6) * 20 + 20)}%` }}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      {showBotOffer && (
                        <button
                          id="uno-play-bots-btn"
                          type="button"
                          onClick={() =>
                            void startSearch({
                              size,
                              opponents: 'bots',
                            })
                          }
                          disabled={busy}
                          className="chat-theme-accent-button flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-white cursor-pointer disabled:opacity-60"
                        >
                          <Bot className="h-4 w-4" />
                          Taking too long? Play with bots
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void cancelSearch()}
                        className="w-full rounded-lg border border-stone-300 py-2.5 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800 md:py-2 md:text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="ui-surface flex items-start gap-3 rounded-2xl p-4 text-xs text-stone-500 dark:text-stone-400">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Tables are private and anonymous. The deck lives on the server, your hand is never
                  sent to the other seats, and the game disappears when you leave. Bot seats are
                  played by CourseMates itself.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
