import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { AccessGateway } from './components/AccessGateway';
import { MatchmakingQueue } from './components/MatchmakingQueue';
import { ChatRoom } from './components/ChatRoom';
import { StudentSession, ActivePeerInfo } from './types';
import { apiRequest } from './utils/api';
import { getSoundEnabled, setSoundEnabled } from './utils/sound';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('coursemates_darkmode');
      if (saved !== null) return saved === 'true';
    } catch { /* Storage may be unavailable in private browsers. */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => getSoundEnabled());
  const [session, setSession] = useState<StudentSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [activePeer, setActivePeer] = useState<ActivePeerInfo | null>(null);
  const [activeTopic, setActiveTopic] = useState('General Peer Discovery');
  const [activeWs, setActiveWs] = useState<WebSocket | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string>();
  const [error, setError] = useState('');
  const [queueKey, setQueueKey] = useState(0);
  const [autoSearch, setAutoSearch] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light';
    try { localStorage.setItem('coursemates_darkmode', String(isDarkMode)); } catch {}
  }, [isDarkMode]);
  useEffect(() => {
    let disposed = false;
    apiRequest('/api/auth/session').then(data => { if (!disposed) setSession(data.session); })
      .catch(() => {}).finally(() => { if (!disposed) setRestoring(false); });
    return () => { disposed = true; };
  }, []);
  const resetChat = () => {
    activeWs?.close();
    setActiveWs(null);
    setActivePeer(null);
    setActiveRoomId(undefined);
  };
  const handleRerollHandle = async () => {
    if (!session) return;
    try {
      const data = await apiRequest('/api/auth/reroll', session.token, {});
      setSession(data.session);
      setError('');
    } catch (err) { setError((err as Error).message); }
  };
  const handleSessionUpdate = (updatedSession: StudentSession) => setSession(updatedSession);
  const handleLogout = async () => {
    if (session) {
      try { await apiRequest('/api/auth/logout', session.token, {}); }
      catch (err) { setError((err as Error).message); return; }
    }
    resetChat();
    setSession(null);
    setError('');
    setAutoSearch(false);
  };
  const handleMatched = (peer: ActivePeerInfo, topic: string, ws?: WebSocket, roomId?: string) => {
    setActivePeer(peer); setActiveTopic(topic); setActiveWs(ws || null); setActiveRoomId(roomId);
  };
  return (
    <div className={'fixed inset-0 min-h-[100dvh] w-full flex flex-col font-sans overflow-hidden ' + (isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800')}>
      {session && <Header session={session} onRerollHandle={handleRerollHandle} onLogout={handleLogout}
        isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(value => !value)}
        isSoundEnabled={isSoundEnabled} onToggleSound={() => setIsSoundEnabled(value => { const next = !value; setSoundEnabled(next); return next; })}
        showReroll={!activePeer} />}
      {error && <div role="alert" className="px-4 py-2 bg-red-100 text-red-900 text-sm flex justify-between gap-3">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <main className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
        {restoring ? <p role="status" className="m-auto">Loading your session…</p> : !session ?
          <AccessGateway onVerified={setSession} isDarkMode={isDarkMode} onToggleDarkMode={() => setIsDarkMode(value => !value)}
            isSoundEnabled={isSoundEnabled} onToggleSound={() => setIsSoundEnabled(value => { const next = !value; setSoundEnabled(next); return next; })} /> :
          activePeer ? <ChatRoom key={activeRoomId} session={session} peer={activePeer} topic={activeTopic} ws={activeWs || undefined} roomId={activeRoomId}
            onNextMatch={() => { resetChat(); setAutoSearch(true); setQueueKey(k => k + 1); }}
            onLeaveChat={() => { resetChat(); setAutoSearch(false); }}
            isDarkMode={isDarkMode} /> :
          <MatchmakingQueue key={queueKey} session={session} onMatched={handleMatched} onRerollHandle={handleRerollHandle} onSessionUpdate={handleSessionUpdate} isDarkMode={isDarkMode} autoSearch={autoSearch} />}
      </main>
    </div>
  );
}
