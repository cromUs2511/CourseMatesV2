import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Loader2, Bot, ArrowRight, Shield, Sparkles } from 'lucide-react';
import { StudentSession, ActivePeerInfo, Campus, AcademicDiscipline } from '../types';
import { SIMULATED_PEERS } from '../data/mockData';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';

interface MatchmakingQueueProps {
  session: StudentSession;
  onMatched: (peer: ActivePeerInfo, topic: string, ws?: WebSocket, roomId?: string) => void;
  onRerollHandle: () => void;
  onSessionUpdate: (session: StudentSession) => void;
  isDarkMode: boolean;
  autoSearch?: boolean;
}

export const MatchmakingQueue: React.FC<MatchmakingQueueProps> = ({
  session,
  onMatched,
  onRerollHandle,
  onSessionUpdate,
  isDarkMode,
  autoSearch = false,
}) => {
  const [isSearching, setIsSearching] = useState(false);
  const [queueTime, setQueueTime] = useState(0);
  const [error, setError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(session.customHandle ? session.sessionHandle : '');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [customInterestInput, setCustomInterestInput] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const searchingRef = useRef(false);
  const isMatchedRef = useRef(false);
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
    setError('');
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
        else if (data.status === 'idle') fail(new Error('Your queue entry expired. Please try again.'));
      } catch (err) { fail(err); }
      finally { busy = false; }
    };
    const fallback = async () => {
      if (!current() || polling) return;
      polling = true;
      closeSocket();
      try {
        const data = await apiRequest('/api/match/join', session.token, { interests: selectedInterests });
        if (!current()) { void apiRequest('/api/match/cancel', session.token, {}).catch(() => {}); return; }
        if (data.status === 'matched') handleMatchSuccess(data);
        else pollIntervalRef.current = setInterval(poll, 1500);
      } catch (err) { fail(err); }
    };
    try {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/chat');
      wsRef.current = ws;
      const connectionTimeout = setTimeout(() => { if (current() && ws.readyState !== WebSocket.OPEN) void fallback(); }, 4000);
      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        if (!current()) { closeSocket(); return; }
        ws.send(JSON.stringify({ type: 'join_queue', token: session.token, interests: selectedInterests }));
        // Poll the same state as the socket; this also keeps the queue lease alive.
        pollIntervalRef.current = setInterval(poll, 1500);
      };
      ws.onmessage = event => {
        if (!current()) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'matched') handleMatchSuccess(data);
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
    const primaryTopic = selectedInterests[0] || 'Engineering Review';
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

  const handleAddInterest = (e: React.FormEvent) => {
    e.preventDefault();
    const val = customInterestInput.trim();
    if (!val || isSearching || val.length > 100 || selectedInterests.length >= 16) return;

    if (!selectedInterests.includes(val)) {
      setSelectedInterests((prev) => [...prev, val]);
    }
    setCustomInterestInput('');
  };
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
    <div className="flex-1 min-h-0 w-full h-full flex flex-col items-center p-3 sm:p-6 overflow-y-auto select-none">
      <div className="w-full max-w-2xl space-y-4 my-auto">
        {/* User Identity Profile Card (Sharp corners, clean styling, no emojis/icons) */}
        <div
          className={`border p-3 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 ${
            isDarkMode
              ? 'bg-[#181716] border-stone-800 text-stone-100'
              : 'bg-white border-stone-300 text-stone-800'
          }`}
        >
          <div className="flex items-center space-x-3.5 min-w-0">
            <div className="min-w-0">
              {!isEditingName ? (
                <div className="flex flex-wrap items-center gap-2">
                 <span className="max-w-full break-words font-bold text-base tracking-tight text-stone-900 dark:text-white font-mono">
                    {session.sessionHandle}
                  </span>
                  {!session.customHandle && <button
                    onClick={onRerollHandle}
                    disabled={isSearching}
                    title="Shuffle default name"
                    className="p-1 border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:text-[#991B1B] dark:hover:text-[#F87171] transition-colors cursor-pointer shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>}
                  <button
                    type="button"
                    onClick={() => { setNameInput(session.customHandle ? session.sessionHandle : ''); setIsEditingName(true); }}
                    disabled={isSearching}
                    className="border border-[#991B1B] bg-[#991B1B] px-2.5 py-1 text-[10px] font-mono font-semibold text-white transition-colors hover:bg-[#7F1D1D] disabled:opacity-50"
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
                    className="w-44 border border-stone-300 bg-white px-2 py-1 text-xs text-stone-900 outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  />
                  <button type="submit" className="border border-[#991B1B] bg-[#991B1B] px-2.5 py-1 text-[10px] font-mono font-semibold text-white hover:bg-[#7F1D1D]">Save</button>
                  <button type="button" onClick={() => setIsEditingName(false)} className="border border-stone-300 px-2.5 py-1 text-[10px] font-mono text-stone-500 dark:border-stone-700">Cancel</button>
                </form>
              )}

              <div className="mt-1 text-xs font-mono text-stone-500 dark:text-stone-400">
                <span className="text-[#991B1B] dark:text-[#F87171] font-semibold">
                  {session.isVerified ? 'Verified account' : 'Demo access'}
                </span>
              </div>
            </div>
          </div>

          <div className="text-left sm:text-right shrink-0 text-xs border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto border-stone-200 dark:border-stone-800 font-mono">
            <span className="text-[10px] text-stone-400 block uppercase tracking-wider font-semibold">
              Private session
            </span>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {session.email}
            </span>
          </div>
        </div>

        {/* Main Interest / Topic Selection Card */}
        <div
          className={`border p-4 sm:p-7 space-y-5 sm:space-y-6 shadow-xl ${
            isDarkMode
              ? 'bg-[#181716] border-stone-800 text-stone-100 shadow-stone-950/40'
              : 'bg-white border-stone-200/80 text-stone-800 shadow-stone-200/50'
          }`}
        >
          <div className="border-b border-stone-200 dark:border-stone-800 pb-3">
           <h2 className="text-lg font-bold text-stone-900 dark:text-white">Add an interest</h2>
           <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
             Optional: add something you'd like to discuss
           </p>
          </div>

          <div className="space-y-3">
           <form onSubmit={handleAddInterest} className="flex space-x-2">
             <input
               type="text"
               maxLength={100}
               aria-label="Add an interest"
               value={customInterestInput}
               onChange={(e) => setCustomInterestInput(e.target.value)}
               placeholder="Type an interest (optional)"
               disabled={isSearching}
               className={`flex-1 px-3 py-2 border text-xs font-mono focus:outline-none focus:border-[#991B1B] ${
                 isDarkMode ? 'bg-stone-900 border-stone-700 text-white' : 'bg-white border-stone-300 text-stone-900'
               }`}
             />
             <button
               type="submit"
               disabled={isSearching || !customInterestInput.trim()}
               className="px-4 py-2 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
             >
               Add
             </button>
           </form>
           {selectedInterests.length > 0 && (
             <p className="text-xs font-mono text-stone-500 dark:text-stone-400">
               Added: {selectedInterests.join(', ')}
             </p>
           )}
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
                  className="w-full py-3.5 px-6 bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-colors cursor-pointer"
                >
                  <span>Find my peers</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div className="text-[11px] font-mono text-stone-400 flex items-center justify-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#991B1B] dark:text-[#F87171]" />
                  <span>Private rooms • Messages cleared when the chat ends</span>
                </div>
              </div>
            ) : (
              <div className="p-5 border border-stone-300 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-3">
                <div className="flex items-center justify-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#991B1B]" />
                  <span className="font-semibold text-xs font-mono text-stone-800 dark:text-stone-200">
                    Finding active Mapúa study peers... ({queueTime}s)
                  </span>
                </div>

                <div className="w-full bg-stone-200 dark:bg-stone-800 h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-[#991B1B] transition-all duration-300"
                    style={{ width: `${Math.min(100, (queueTime % 6) * 20 + 20)}%` }}
                  />
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
                  <button
                    id="cancel-queue-btn"
                    type="button"
                    onClick={cancelMatchmaking}
                    className="w-full sm:w-auto px-4 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-xs font-mono text-stone-700 dark:text-stone-300 hover:bg-stone-50 cursor-pointer"
                  >
                    Cancel Search
                  </button>

                  {showSimulateOption && (
                    <button
                      id="simulate-peer-btn"
                      type="button"
                      onClick={pairWithSimulatedPeer}
                      className="w-full sm:w-auto px-4 py-2 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <Bot className="w-4 h-4" />
                      <span>Try a simulated study partner</span>
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
