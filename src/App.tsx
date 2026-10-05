import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { AccessGateway } from './components/AccessGateway';
import { MatchmakingQueue } from './components/MatchmakingQueue';
import { ChatRoom } from './components/ChatRoom';
import { StudentSession, ActivePeerInfo } from './types';
import { apiRequest, SESSION_EXPIRED_EVENT } from './utils/api';
import { getSoundEnabled, setSoundEnabled } from './utils/sound';
import { CHAT_THEMES, ChatThemeMenu, type ChatTheme } from './components/ChatThemeMenu';
import { AdminDashboard } from './components/AdminDashboard';
import { saveActiveChat, loadActiveChat, clearActiveChat } from './utils/chatReconnect';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('coursemates_darkmode');
      if (saved !== null) return saved === 'true';
    } catch {
      /* Storage may be unavailable in private browsers. */
    }
    return false;
  });
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => getSoundEnabled());
  const [chatTheme, setChatTheme] = useState<ChatTheme>(() => {
    try {
      const saved = localStorage.getItem('coursemates_chat_theme');
      return CHAT_THEMES.find((theme) => theme.id === saved) || CHAT_THEMES[0]!;
    } catch {
      return CHAT_THEMES[0]!;
    }
  });
  const [session, setSession] = useState<StudentSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [activePeer, setActivePeer] = useState<ActivePeerInfo | null>(null);
  const [activeTopic, setActiveTopic] = useState('General Peer Discovery');
  const [activeWs, setActiveWs] = useState<WebSocket | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string>();
  const [restoringChat, setRestoringChat] = useState<'idle' | 'checking' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [queueKey, setQueueKey] = useState(0);
  const [autoSearch, setAutoSearch] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const isAdminRoute =
    window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light';
    try {
      localStorage.setItem('coursemates_darkmode', String(isDarkMode));
    } catch {}
  }, [isDarkMode]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const updateAppHeight = () => {
      document.documentElement.style.setProperty(
        '--app-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
      document.documentElement.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`);
    };
    updateAppHeight();
    viewport?.addEventListener('resize', updateAppHeight);
    viewport?.addEventListener('scroll', updateAppHeight);
    window.addEventListener('orientationchange', updateAppHeight);
    return () => {
      viewport?.removeEventListener('resize', updateAppHeight);
      viewport?.removeEventListener('scroll', updateAppHeight);
      window.removeEventListener('orientationchange', updateAppHeight);
      document.documentElement.style.removeProperty('--app-height');
      document.documentElement.style.removeProperty('--app-top');
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    apiRequest('/api/auth/session')
      .then((data) => {
        if (!disposed) setSession(data.session);
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) setRestoring(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    apiRequest<{ authenticated: boolean }>('/api/admin/session')
      .then((result) => {
        if (!disposed) setIsAdmin(result.authenticated);
      })
      .catch(() => {
        if (!disposed) setIsAdmin(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const resetChat = () => {
    activeWs?.close();
    setActiveWs(null);
    setActivePeer(null);
    setActiveRoomId(undefined);
    clearActiveChat();
  };
  useEffect(() => {
    const expired = () => {
      activeWs?.close();
      setActiveWs(null);
      setActivePeer(null);
      setActiveRoomId(undefined);
      clearActiveChat();
      setSession(null);
      setAutoSearch(false);
      setError('Your session ended. Continue to start a new anonymous session.');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [activeWs]);
  // Rejoin the same chat after a reload or a backgrounded tab was discarded.
  // The room itself decides: a live room restores with its current messages,
  // while an ended, expired, or cleaned-up room reports honestly.
  // A ref (not state) guards the one-shot check so the status update below
  // cannot retrigger the effect and strand the validation.
  const restoreAttempted = useRef(false);
  useEffect(() => {
    if (restoring || !session || activePeer || restoreAttempted.current) return;
    const saved = loadActiveChat();
    if (!saved || saved.sessionId !== session.id) return;
    restoreAttempted.current = true;
    let disposed = false;
    setRestoringChat('checking');
    apiRequest<{ active: boolean }>('/api/chat/messages?roomId=' + encodeURIComponent(saved.roomId))
      .then((data) => {
        if (disposed) return;
        if (data.active) {
          setActivePeer(saved.peer);
          setActiveTopic(saved.topic);
          setActiveRoomId(saved.roomId);
          setActiveWs(null);
          setRestoringChat('idle');
          setError('');
        } else {
          clearActiveChat();
          setRestoringChat('failed');
          setError('Your previous chat ended while you were away. Find new peers below.');
        }
      })
      .catch(() => {
        // A 401 already cleared the session with its own explanation.
        if (!disposed) setRestoringChat('idle');
      });
    return () => {
      disposed = true;
    };
  }, [restoring, session, activePeer]);
  // Rebind the live socket whenever the chat has none: a backgrounded browser
  // may have killed it while polling kept the room alive. The server replaces
  // the previous socket for the session, so no duplicates accumulate.
  const rebindAttempts = useRef(0);
  const [foregroundTick, setForegroundTick] = useState(0);
  useEffect(() => {
    const bump = () => setForegroundTick((tick) => tick + 1);
    const onVisibility = () => {
      if (!document.hidden) bump();
    };
    window.addEventListener('online', bump);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', bump);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  useEffect(() => {
    if (!session || !activePeer || activePeer.isSimulated || !activeRoomId) return;
    if (activeWs && activeWs.readyState <= WebSocket.OPEN) return;
    let disposed = false;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(rebindAttempts.current, 3));
    const timer = setTimeout(() => {
      if (disposed) return;
      // Only bind when the room is still there; otherwise polling drives the
      // honest ended-chat UI instead of silently queueing the user again.
      apiRequest<{ active: boolean }>(
        '/api/chat/messages?roomId=' + encodeURIComponent(activeRoomId),
      )
        .then((data) => {
          if (disposed || !data.active) return;
          const ws = new WebSocket(
            (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/chat',
          );
          ws.onopen = () => {
            if (disposed) {
              ws.close();
              return;
            }
            rebindAttempts.current = 0;
            ws.send(JSON.stringify({ type: 'join_queue', interests: [], allowNormal: true }));
            setActiveWs(ws);
          };
          ws.onclose = () => {
            rebindAttempts.current += 1;
            if (!disposed) setActiveWs(null);
          };
          ws.onerror = () => {
            rebindAttempts.current += 1;
            if (!disposed) setActiveWs(null);
          };
        })
        .catch(() => {
          if (!disposed) {
            rebindAttempts.current += 1;
            setForegroundTick((tick) => tick + 1);
          }
        });
    }, delay);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [session, activePeer, activeRoomId, activeWs, foregroundTick]);
  const handleRerollHandle = async () => {
    if (!session) return;
    try {
      const data = await apiRequest('/api/auth/reroll', {});
      setSession(data.session);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const handleSessionUpdate = (updatedSession: StudentSession) => setSession(updatedSession);
  const handleChatThemeChange = (next: ChatTheme) => {
    setChatTheme(next);
    try {
      localStorage.setItem('coursemates_chat_theme', next.id);
    } catch {}
  };
  const handleLogout = async () => {
    if (session) {
      try {
        await apiRequest('/api/auth/logout', {});
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    resetChat();
    setSession(null);
    setError('');
    setAutoSearch(false);
  };
  const handleMatched = (peer: ActivePeerInfo, topic: string, ws?: WebSocket, roomId?: string) => {
    setActivePeer(peer);
    setActiveTopic(topic);
    setActiveWs(ws || null);
    setActiveRoomId(roomId);
    setRestoringChat('idle');
    // Simulated chats have no server room to rejoin; only real rooms persist.
    if (roomId && !peer.isSimulated)
      saveActiveChat({ version: 1, sessionId: session?.id ?? '', roomId, peer, topic });
  };
  const headerProps = {
    session,
    onRerollHandle: handleRerollHandle,
    onLogout: handleLogout,
    isDarkMode,
    onToggleDarkMode: () => setIsDarkMode((value) => !value),
    isSoundEnabled,
    onToggleSound: () =>
      setIsSoundEnabled((value) => {
        const next = !value;
        setSoundEnabled(next);
        return next;
      }),
  };
  if (isAdminRoute) return <AdminDashboard isDarkMode={isDarkMode} />;
  return (
    <div
      className={
        'app-shell fixed inset-x-0 w-full flex flex-col font-sans overflow-hidden ' +
        (isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800')
      }
      style={
        {
          '--chat-accent': chatTheme.accent,
          '--chat-accent-hover': chatTheme.accentHover,
        } as React.CSSProperties
      }
    >
      {session && !activePeer && (
        <Header
          {...headerProps}
          displayActions={
            <div className="flex items-center gap-2">
              {isAdmin && (
                <a
                  href="/admin"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-xs font-bold text-emerald-600 dark:text-emerald-300"
                  aria-label="Administrator dashboard"
                >
                  <span aria-hidden="true">●</span> Admin
                </a>
              )}
              <ChatThemeMenu
                theme={chatTheme}
                onChange={handleChatThemeChange}
                isDarkMode={isDarkMode}
                standalone
                compact
              />
            </div>
          }
        />
      )}
      {error && (
        <div
          role="alert"
          className="px-4 py-2 bg-red-100 text-red-900 text-sm flex justify-between gap-3"
        >
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      <main className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
        {restoring || restoringChat === 'checking' ? (
          <p role="status" className="m-auto">
            {restoringChat === 'checking' ? 'Reconnecting…' : 'Loading your session…'}
          </p>
        ) : !session ? (
          <AccessGateway
            onVerified={setSession}
            isDarkMode={isDarkMode}
            onToggleDarkMode={() => setIsDarkMode((value) => !value)}
            isSoundEnabled={isSoundEnabled}
            onToggleSound={() =>
              setIsSoundEnabled((value) => {
                const next = !value;
                setSoundEnabled(next);
                return next;
              })
            }
          />
        ) : activePeer ? (
          <ChatRoom
            key={activeRoomId}
            session={session}
            peer={activePeer}
            topic={activeTopic}
            ws={activeWs || undefined}
            roomId={activeRoomId}
            onNextMatch={() => {
              resetChat();
              setAutoSearch(true);
              setQueueKey((k) => k + 1);
            }}
            onLeaveChat={() => {
              resetChat();
              setAutoSearch(false);
            }}
            isDarkMode={isDarkMode}
            headerProps={headerProps}
            chatTheme={chatTheme}
            onChatThemeChange={handleChatThemeChange}
          />
        ) : (
          <MatchmakingQueue
            key={queueKey}
            session={session}
            onMatched={handleMatched}
            onRerollHandle={handleRerollHandle}
            onSessionUpdate={handleSessionUpdate}
            isDarkMode={isDarkMode}
            autoSearch={autoSearch}
            chatTheme={chatTheme}
          />
        )}
      </main>
    </div>
  );
}
