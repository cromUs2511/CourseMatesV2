import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { AccessGateway } from './components/AccessGateway';
import { MatchmakingQueue } from './components/MatchmakingQueue';
import { ChatRoom } from './components/ChatRoom';
import { StudentSession, ActivePeerInfo } from './types';
import { playChime } from './utils/sound';

export default function App() {
  // Dark mode theme state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('coursemates_darkmode');
      if (saved !== null) {
        return saved === 'true';
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Sync dark class with document element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('coursemates_darkmode', String(isDarkMode));
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
    playChime('click');
  };

  // Session state
  const [session, setSession] = useState<StudentSession | null>(null);

  // Active 1-on-1 Chat state
  const [activePeer, setActivePeer] = useState<ActivePeerInfo | null>(null);
  const [activeTopic, setActiveTopic] = useState<string>('General Peer Discovery');
  const [activeWs, setActiveWs] = useState<WebSocket | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>(undefined);

  // Simulated online active count
  const [onlineCount, setOnlineCount] = useState(48);

  // Periodic subtle fluctuation of online active peer counter
  useEffect(() => {
    const interval = setInterval(() => {
      setOnlineCount((prev) => Math.max(34, prev + (Math.random() > 0.5 ? 1 : -1)));
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // Handle Handle Randomization
  const handleRerollHandle = () => {
    if (!session) return;
    const ADJECTIVES = ['Curious', 'Astute', 'Quantum', 'Resilient', 'Pragmatic', 'Keen', 'Ingenious', 'Dynamic', 'Luminous'];
    const NOUNS = ['Cardinal', 'Falcon', 'Tamaraw', 'Builder', 'Coder', 'Architect', 'Hawk', 'Innovator', 'Explorer'];
    const AVATARS = ['🦅', '🦁', '🦉', '🚀', '⚡', '📐', '💻', '🎨', '⚙️', '🌟'];

    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

    setSession({
      ...session,
      sessionHandle: `${adj} ${noun} #${num}`,
      sessionAvatar: avatar,
    });
    playChime('click');
  };

  // Handle Logout / Reset
  const handleLogout = () => {
    playChime('purge');
    if (activeWs) {
      activeWs.close();
      setActiveWs(null);
    }
    setActivePeer(null);
    setActiveRoomId(undefined);
    setSession(null);
  };

  // When a match is made in the FIFO queue
  const handleMatched = (peer: ActivePeerInfo, topic: string, ws?: WebSocket, roomId?: string) => {
    setActivePeer(peer);
    setActiveTopic(topic);
    setActiveWs(ws || null);
    setActiveRoomId(roomId);
  };

  // Next match triggered from inside chat
  const handleNextMatch = () => {
    if (activeWs && activeRoomId) {
      try {
        activeWs.send(JSON.stringify({ type: 'leave_room', roomId: activeRoomId }));
        activeWs.close();
      } catch {
        // ignore
      }
    }
    setActiveWs(null);
    setActiveRoomId(undefined);
    setActivePeer(null);
  };

  // Leave active chat and return to queue screen
  const handleLeaveChat = () => {
    if (activeWs && activeRoomId) {
      try {
        activeWs.send(JSON.stringify({ type: 'leave_room', roomId: activeRoomId }));
        activeWs.close();
      } catch {
        // ignore
      }
    }
    setActiveWs(null);
    setActiveRoomId(undefined);
    setActivePeer(null);
  };

  return (
    <div
      className={`fixed inset-0 h-screen h-[100dvh] w-screen w-full flex flex-col font-sans transition-colors duration-200 overflow-hidden select-none selection:bg-[#991B1B] selection:text-white ${
        isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800'
      }`}
    >
      {/* Top Application Header - pinned permanently at the very top */}
      <Header
        session={session}
        onRerollHandle={handleRerollHandle}
        onLogout={handleLogout}
        onlineCount={onlineCount}
        isDarkMode={isDarkMode}
        onToggleDarkMode={toggleDarkMode}
      />

      {/* Main Content Area - occupies 100% of remaining viewport height */}
      <main className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
        {!session ? (
          /* Institutional Verification Step */
          <AccessGateway
            onVerified={(newSession) => setSession(newSession)}
            isDarkMode={isDarkMode}
          />
        ) : (
          /* 1-on-1 Matching / Active Chat Room */
          <>
            {activePeer ? (
              <ChatRoom
                session={session}
                peer={activePeer}
                topic={activeTopic}
                ws={activeWs || undefined}
                roomId={activeRoomId}
                onNextMatch={handleNextMatch}
                onLeaveChat={handleLeaveChat}
                isDarkMode={isDarkMode}
              />
            ) : (
              <MatchmakingQueue
                session={session}
                onMatched={handleMatched}
                onRerollHandle={handleRerollHandle}
                isDarkMode={isDarkMode}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
