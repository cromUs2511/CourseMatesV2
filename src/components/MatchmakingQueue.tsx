import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Loader2, Bot, ArrowRight, Shield } from 'lucide-react';
import { StudentSession, ActivePeerInfo, Campus, AcademicDiscipline } from '../types';
import { SIMULATED_PEERS } from '../data/mockData';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import type { ChatTheme } from './ChatThemeMenu';

const MATCH_POLL_INTERVAL_MS = 400;
const MATCH_SOCKET_TIMEOUT_MS = 1500;
const CHAT_INTENTS = [
  { label: 'Study together', description: 'Focus and work alongside a peer' },
  { label: 'Ask for help', description: 'Get support with a question or topic' },
  { label: 'Casual conversation', description: 'Have a relaxed, friendly chat' },
  { label: 'Vent anonymously', description: 'Talk freely in a private space' },
  { label: 'Surprise me', description: 'Match with any available peer' },
] as const;

interface MatchmakingQueueProps {
  session: StudentSession;
  onMatched: (peer: ActivePeerInfo, topic: string, ws?: WebSocket, roomId?: string) => void;
  onRerollHandle: () => void;
  onSessionUpdate: (session: StudentSession) => void;
  isDarkMode: boolean;
  autoSearch?: boolean;
  chatTheme: ChatTheme;
}

export const MatchmakingQueue: React.FC<MatchmakingQueueProps> = ({
  session,
  onMatched,
  onRerollHandle,
  onSessionUpdate,
  isDarkMode,
  autoSearch = false,
  chatTheme,
}) => {
  const [isSearching, setIsSearching] = useState(false);
  const [queueTime, setQueueTime] = useState(0);
  const [error, setError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(session.customHandle ? session.sessionHandle : '');
  const [selectedIntent, setSelectedIntent] = useState<string>('Surprise me');
  const [canProceedNormally, setCanProceedNormally] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const searchingRef = useRef(false);
  const isMatchedRef = useRef(false);
  const allowNormalRef = useRef(false);
  const matchingInterestsRef = useRef<string[]>([]);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const showSimulateOption = isSearching && queueTime >= 3;

  const clearPolling = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
  };
  const closeSocket = () => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); }
  };
  useEffect(() => {
    if (!isSearching) { setQueueTime(0); return; }
    const timer = setInterval(() => setQueueTime(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isSearching]);
  useEffect(() => () => {
    ++attemptRef.current;
    clearPolling();
    // The chat owns the socket after a match.
    if (!isMatchedRef.current) {
      closeSocket();
      if (searchingRef.current) void apiRequest('/api/match/cancel', session.token, {}).catch(() => {});
    }
  }, [session.token]);

  const handleMatchSuccess = (data: any) => {
    if (isMatchedRef.current || !searchingRef.current) return;
    isMatchedRef.current = true;
    searchingRef.current = false;
    clearPolling();
    playChime('match');
    const matchedPeer: ActivePeerInfo = {
      ...data.peer, sessionId: data.peer.sessionId, interests: data.peer.interests || [],
      topic: data.topic || 'General Peer Discovery', matchedAt: Date.now(),
    };
    const socket = wsRef.current;
    if (socket) { socket.onmessage = null; socket.onerror = null; socket.onclose = null; }
    onMatched(matchedPeer, matchedPeer.topic, socket || undefined, data.roomId);
  };
  const startMatchmaking = () => {
    if (searchingRef.current) return;
    const interestsToMatch = selectedIntent === 'Surprise me' ? [] : [selectedIntent];
    setError('');
    setCanProceedNormally(false);
    matchingInterestsRef.current = interestsToMatch;
    allowNormalRef.current = selectedIntent === 'Surprise me';
    setIsSearching(true);
    searchingRef.current = true;
    isMatchedRef.current = false;
    const attempt = ++attemptRef.current;
    const current = () => attemptRef.current === attempt && searchingRef.current;
    let polling = false;
    let busy = false;
    const fail = (err: unknown) => {
      if (!current()) return;
      setError(err instanceof Error ? err.message : 'Unable to connect. Please try again.');
      searchingRef.current = false;
      setIsSearching(false);
      clearPolling();
      closeSocket();
      void apiRequest('/api/match/cancel', session.token, {}).catch(() => {});
    };
    const poll = async () => {
      if (!current() || busy) return;
      busy = true;
      try {
        const data = await apiRequest('/api/match/poll', session.token);
        if (!current()) return;
        if (data.status === 'matched') handleMatchSuccess(data);
        else if (data.status === 'queued') setCanProceedNormally(data.interestMatchUnavailable === true && !allowNormalRef.current);
        else if (data.status === 'idle') fail(new Error('Your queue entry expired. Please try again.'));
      } catch (err) { fail(err); }
      finally { busy = false; }
    };
    const fallback = async () => {
      if (!current() || polling) return;
      polling = true;
      closeSocket();
      try {
        const data = await apiRequest('/api/match/join', session.token, { interests: interestsToMatch, allowNormal: allowNormalRef.current });
        if (!current()) { void apiRequest('/api/match/cancel', session.token, {}).catch(() => {}); return; }
        if (data.status === 'matched') handleMatchSuccess(data);
        else {
          void poll();
          pollIntervalRef.current = setInterval(poll, MATCH_POLL_INTERVAL_MS);
        }
      } catch (err) { fail(err); }
    };
    try {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/chat');
      wsRef.current = ws;
      const connectionTimeout = setTimeout(() => { if (current() && ws.readyState !== WebSocket.OPEN) void fallback(); }, MATCH_SOCKET_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        if (!current()) { closeSocket(); return; }
        ws.send(JSON.stringify({ type: 'join_queue', token: session.token, interests: interestsToMatch, allowNormal: allowNormalRef.current }));
        // Poll the same state as the socket; this also keeps the queue lease alive.
        void poll();
        pollIntervalRef.current = setInterval(poll, MATCH_POLL_INTERVAL_MS);
      };
      ws.onmessage = event => {
        if (!current()) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'matched') handleMatchSuccess(data);
          else if (data.type === 'queued') setCanProceedNormally(data.interestMatchUnavailable === true && !allowNormalRef.current);
          else if (data.type === 'error') fail(new Error(data.error));
        } catch { fail(new Error('Invalid matchmaking response.')); }
      };
      ws.onerror = () => { clearTimeout(connectionTimeout); clearPolling(); void fallback(); };
      ws.onclose = event => {
        clearTimeout(connectionTimeout); clearPolling();
        if (event.code === 1008) fail(new Error('Your session expired. Sign out and try again.'));
        else void fallback();
      };
    } catch { void fallback(); }
  };
  const proceedWithNormalMatching = async () => {
    if (!searchingRef.current || allowNormalRef.current) return;
    allowNormalRef.current = true;
    setCanProceedNormally(false);
    setError('');
    try {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'join_queue', token: session.token, interests: matchingInterestsRef.current, allowNormal: true }));
        return;
      }
      const data = await apiRequest('/api/match/join', session.token, { interests: matchingInterestsRef.current, allowNormal: true });
      if (data.status === 'matched') handleMatchSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue matching. Please try again.');
      allowNormalRef.current = false;
      setCanProceedNormally(true);
    }
  };
  const cancelMatchmaking = async () => {
    ++attemptRef.current;
    searchingRef.current = false;
    clearPolling();
    closeSocket();
    try { await apiRequest('/api/match/cancel', session.token, {}); }
    catch (err) { setError((err as Error).message); }
    setIsSearching(false);
  };
  const pairWithSimulatedPeer = async () => {
    await cancelMatchmaking();
    isMatchedRef.current = true;
    const randomPeer = SIMULATED_PEERS[Math.floor(Math.random() * SIMULATED_PEERS.length)];
    const primaryTopic = matchingInterestsRef.current[0] || 'General Peer Discovery';
    onMatched({
      ...randomPeer, sessionId: 'sim_' + Date.now(), topic: primaryTopic,
      matchedAt: Date.now(), isSimulated: true,
    }, primaryTopic, undefined, 'sim_room_' + Date.now());
  };
  useEffect(() => {
    if (!autoSearch) return;
    const timer = setTimeout(startMatchmaking, 0);
    return () => clearTimeout(timer);
  }, [autoSearch]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameInput.trim() || isSearching) return;
    try {
      const data = await apiRequest('/api/auth/handle', session.token, { name: nameInput });
      onSessionUpdate(data.session);
      setIsEditingName(false);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div
      className="ambient-grid chat-theme-scope flex-1 min-h-0 w-full h-full flex flex-col items-center px-4 py-6 sm:px-6 sm:py-10 overflow-y-auto select-none"
      style={{
        backgroundColor: isDarkMode ? chatTheme.darkBackground : chatTheme.lightBackground,
        '--chat-accent': chatTheme.accent,
        '--chat-accent-hover': chatTheme.accentHover,
      } as React.CSSProperties}
    >
      <div className="w-full max-w-2xl space-y-4 my-auto">
        {/* User Identity Profile Card (Sharp corners, clean styling, no emojis/icons) */}
        <div
          className={`ui-surface rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
            isDarkMode
              ? 'text-stone-100'
              : 'text-stone-800'
          }`}
        >
          <div className="flex items-center space-x-3.5 min-w-0">
            <div className="min-w-0">
              {!isEditingName ? (
                <div className="flex flex-wrap items-center gap-2">
                 <span className="max-w-full break-words text-base font-bold tracking-tight text-stone-900 dark:text-white">
                    {session.sessionHandle}
                  </span>
                  {!session.customHandle && <button
                    onClick={onRerollHandle}
                    disabled={isSearching}
                    title="Shuffle default name"
                    className="chat-theme-accent-soft rounded-lg p-1.5 border bg-stone-50/80 dark:bg-stone-800/80 transition-colors cursor-pointer shrink-0"
                  >
                    <RefreshCw className="chat-theme-accent-text w-3.5 h-3.5" />
                  </button>}
                  <button
                    type="button"
                    onClick={() => { setNameInput(session.customHandle ? session.sessionHandle : ''); setIsEditingName(true); }}
                    disabled={isSearching}
                    className="chat-theme-accent-soft rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50"
                  >
                    {session.customHandle ? 'Edit name' : 'Use a custom name'}
                  </button>
                </div>
              ) : (
                <form onSubmit={saveName} className="flex items-center gap-2">
                  <input
                    autoFocus
                    maxLength={40}
                    aria-label="Custom name"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Enter a name"
                    className="w-44 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-900 outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  />
                  <button type="submit" className="chat-theme-accent-button rounded-md px-2.5 py-1 text-[10px] font-semibold text-white">Save</button>
                  <button type="button" onClick={() => setIsEditingName(false)} className="rounded-md border border-stone-300 px-2.5 py-1 text-[10px] text-stone-500 dark:border-stone-700">Cancel</button>
                </form>
              )}

              <div className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                <span className="chat-theme-accent-text font-semibold">
                  Anonymous community session
                </span>
              </div>
            </div>
          </div>

          <div className="text-left sm:text-right shrink-0 text-xs border-t sm:border-t-0 pt-3 sm:pt-0 w-full sm:w-auto border-stone-200 dark:border-stone-800">
            <span className="text-[10px] text-stone-400 block uppercase tracking-wider font-semibold">
              Private session
            </span>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              Anonymous community session
            </span>
          </div>
        </div>

        {/* Main chat intent selection card */}
        <div
          className={`ui-surface rounded-2xl p-5 sm:p-7 space-y-5 sm:space-y-6 ${
            isDarkMode
              ? 'text-stone-100'
              : 'text-stone-800'
          }`}
        >
          <div className="border-b border-stone-200 dark:border-stone-800 pb-3">
           <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">What kind of chat do you want?</h2>
           <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
             We’ll prioritize someone looking for the same kind of conversation.
           </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Chat preference">
            {CHAT_INTENTS.map(intent => {
              const selected = selectedIntent === intent.label;
              return (
                <button
                  key={intent.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isSearching}
                  onClick={() => setSelectedIntent(intent.label)}
                  className={`rounded-xl border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected
                      ? 'chat-theme-accent-soft border-current'
                      : 'border-stone-200 bg-white/60 text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-200 dark:hover:bg-stone-800'
                  } ${intent.label === 'Surprise me' ? 'sm:col-span-2' : ''}`}
                >
                  <span className="block text-sm font-bold">{intent.label}</span>
                  <span className="mt-0.5 block text-xs font-normal opacity-70">{intent.description}</span>
                </button>
              );
            })}
          </div>

          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {/* Action Button Area */}
          <div className="border-t border-stone-200 dark:border-stone-800 pt-5 text-center space-y-3">
            {!isSearching ? (
              <div className="space-y-3">
                <button
                  id="start-chat-btn"
                  type="button"
                  onClick={startMatchmaking}
                  className="chat-theme-accent-button w-full rounded-xl py-3.5 px-6 text-white font-bold text-sm flex items-center justify-center space-x-2 transition-colors cursor-pointer"
                >
                  <span>Find my peers</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div className="text-[11px] text-stone-400 flex items-center justify-center space-x-1.5">
                  <Shield className="chat-theme-accent-text w-3.5 h-3.5" />
                  <span>Private rooms • Messages cleared when the chat ends</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl p-5 border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/60 space-y-3">
                <div className="flex items-center justify-center space-x-2">
                  <Loader2 className="chat-theme-accent-text w-4 h-4 animate-spin" />
                  <span className="font-semibold text-xs text-stone-800 dark:text-stone-200">
                    Finding active study peers... ({queueTime}s)
                  </span>
                </div>

                <div className="w-full bg-stone-200 dark:bg-stone-800 h-1.5 overflow-hidden">
                  <div
                    className="chat-theme-accent-button h-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (queueTime % 6) * 20 + 20)}%` }}
                  />
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
                  <button
                    id="cancel-queue-btn"
                    type="button"
                    onClick={cancelMatchmaking}
                    className="w-full sm:w-auto px-4 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-50 cursor-pointer"
                  >
                    Cancel Search
                  </button>

                  {canProceedNormally && (
                    <button
                      id="normal-match-btn"
                      type="button"
                      onClick={proceedWithNormalMatching}
                      className="chat-theme-accent-button w-full sm:w-auto rounded-lg px-4 py-2 text-white text-xs font-bold cursor-pointer"
                    >
                      Proceed with normal matching
                    </button>
                  )}

                  {showSimulateOption && (
                    <button
                      id="simulate-peer-btn"
                      type="button"
                      onClick={pairWithSimulatedPeer}
                      className="chat-theme-accent-button w-full sm:w-auto px-4 py-2 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <Bot className="w-4 h-4" />
                      <span>Try Student Chatbot Assistant</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
