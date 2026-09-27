import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Swords, Users } from 'lucide-react';
import type { UnoAction, UnoStateResponse } from '../../unoTypes';
import { apiRequest } from '../utils/api';
import { UnoTable } from './UnoTable';
import '../uno.css';

const ARENA_POLL_MS = 1200;

export type UnoArenaProps = {
  isDarkMode: boolean;
  onBack: () => void;
  onPlayingChange?: (playing: boolean) => void;
};

export function UnoArena({ isDarkMode, onBack, onPlayingChange }: UnoArenaProps) {
  const [state, setState] = useState<UnoStateResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [queueTime, setQueueTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchingRef = useRef(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiRequest<UnoStateResponse>('/api/uno/state');
      if (!mountedRef.current) return;
      setState(data);
      if (data.game) {
        setSearching(false);
        searchingRef.current = false;
      } else if (!data.queued) {
        setSearching(false);
        searchingRef.current = false;
      }
    } catch {
      /* Polling failures are retried on the next tick. */
    }
  }, []);

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

  const startSearch = async () => {
    setError('');
    setBusy(true);
    try {
      await apiRequest('/api/uno/arena', {});
      searchingRef.current = true;
      setSearching(true);
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
      setState(data);
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

  useEffect(() => {
    onPlayingChange?.(inGame);
  }, [inGame, onPlayingChange]);

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
            className="flex items-center gap-1.5 rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm font-semibold transition hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 md:py-1.5 md:text-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to menu
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            UNO Arena · live 1v1
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
          <div className="flex h-full w-full flex-col items-center justify-center px-4 py-6">
            <div className="w-full max-w-md space-y-4">
              <div className="ui-surface rounded-2xl p-6 text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 -rotate-6 items-center justify-center rounded-2xl border-2 border-yellow-400 bg-red-600 shadow-xl">
                  <span className="text-xl font-black italic tracking-tighter text-white">UNO</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">
                    UNO Arena
                  </h2>
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    A real player joins your table — no bots. Win by clearing your hand first.
                  </p>
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 py-3.5 text-sm font-bold text-white transition hover:bg-stone-700 disabled:opacity-60 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Swords className="h-4 w-4" />
                    )}
                    Find an opponent
                  </button>
                ) : (
                  <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-5 dark:border-stone-700 dark:bg-stone-900/60">
                    <div className="flex items-center justify-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-200">
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      Waiting for another player… ({queueTime}s)
                    </div>
                    <div className="h-1.5 w-full overflow-hidden bg-stone-200 dark:bg-stone-800">
                      <div
                        className="h-full bg-stone-900 transition-all duration-300 dark:bg-white"
                        style={{ width: `${Math.min(100, (queueTime % 6) * 20 + 20)}%` }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void cancelSearch()}
                      className="w-full rounded-lg border border-stone-300 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800 md:py-2 md:text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              <div className="ui-surface flex items-start gap-3 rounded-2xl p-4 text-xs text-stone-500 dark:text-stone-400">
                <Users className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Tables are private and anonymous. The deck lives on the server, your hand is never
                  sent to your opponent, and the game disappears when you leave.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
