import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Loader2, Bot, ArrowRight, Plus, Check, Shield, Sparkles, Hash } from 'lucide-react';
import { StudentSession, ActivePeerInfo, Campus, AcademicDiscipline } from '../types';
import { SIMULATED_PEERS } from '../data/mockData';
import { playChime } from '../utils/sound';

interface MatchmakingQueueProps {
  session: StudentSession;
  onMatched: (peer: ActivePeerInfo, topic: string, ws?: WebSocket, roomId?: string) => void;
  onRerollHandle: () => void;
  isDarkMode: boolean;
}

export const AVAILABLE_INTERESTS = [
  { id: 'coding', label: 'Coding, DSA & Software' },
  { id: 'math', label: 'Calculus & Engineering Math' },
  { id: 'eng', label: 'Circuits, Physics & Hardware' },
  { id: 'thesis', label: 'Thesis & Capstone Ideation' },
  { id: 'ojt', label: 'OJT & Internship Placement' },
  { id: 'study', label: 'Deep Focus & Study Sprints' },
  { id: 'campus', label: 'Campus Life & Quad Hangouts' },
  { id: 'stress', label: 'Term Stress & Venting Lounge' },
  { id: 'ai', label: 'AI, LLMs & Machine Learning' },
  { id: 'arch', label: 'CAD, Drafting & Architecture' },
  { id: 'exam', label: 'Midterm / Final Exam Cram' },
  { id: 'cross', label: 'Cross-Discipline Collab' },
];

export const MatchmakingQueue: React.FC<MatchmakingQueueProps> = ({
  session,
  onMatched,
  onRerollHandle,
  isDarkMode,
}) => {
  const [isSearching, setIsSearching] = useState(false);
  const [queueTime, setQueueTime] = useState(0);
  const [showSimulateOption, setShowSimulateOption] = useState(false);

  const [selectedInterests, setSelectedInterests] = useState<string[]>([
    'Coding, DSA & Software',
  ]);
  const [customInterestInput, setCustomInterestInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customList, setCustomList] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMatchedRef = useRef(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSearching) {
      interval = setInterval(() => {
        setQueueTime((prev) => prev + 1);
      }, 1000);
    } else {
      setQueueTime(0);
      setShowSimulateOption(false);
    }
    return () => clearInterval(interval);
  }, [isSearching]);

  useEffect(() => {
    if (isSearching && queueTime >= 3) {
      setShowSimulateOption(true);
    }
  }, [isSearching, queueTime]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const handleMatchSuccess = (data: {
    roomId: string;
    peer: {
      sessionId?: string;
      handle: string;
      avatar: string;
      campus?: string;
      discipline?: string;
      interests?: string[];
    };
    topic?: string;
  }) => {
    if (isMatchedRef.current) return;
    isMatchedRef.current = true;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    playChime('match');
    const matchedPeer: ActivePeerInfo = {
      sessionId: data.peer.sessionId || 'peer-anon',
      handle: data.peer.handle,
      avatar: data.peer.avatar,
      campus: data.peer.campus as Campus | undefined,
      discipline: data.peer.discipline as AcademicDiscipline | undefined,
      interests: data.peer.interests || [],
      topic: data.topic || 'General Peer Discovery',
      matchedAt: Date.now(),
    };

    onMatched(matchedPeer, matchedPeer.topic, wsRef.current || undefined, data.roomId);
  };

  const startMatchmaking = async () => {
    setIsSearching(true);
    isMatchedRef.current = false;
    playChime('click');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'JOIN_QUEUE',
            session: {
              id: session.token,
              handle: session.sessionHandle,
              avatar: session.sessionAvatar,
              discipline: session.discipline,
              campus: session.campus,
              interests: selectedInterests,
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'matched') {
            handleMatchSuccess({
              roomId: msg.roomId,
              peer: msg.peer,
              topic: msg.topic,
            });
          }
        } catch (e) {
          console.error(e);
        }
      };

      ws.onerror = () => {
        startHttpPolling();
      };
    } catch {
      startHttpPolling();
    }
  };

  const startHttpPolling = () => {
    fetch('/api/match/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.token,
        handle: session.sessionHandle,
        avatar: session.sessionAvatar,
        discipline: session.discipline,
        campus: session.campus,
        interests: selectedInterests,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'matched') {
          handleMatchSuccess(data);
        } else {
          pollIntervalRef.current = setInterval(checkMatchStatus, 2000);
        }
      })
      .catch(() => {});
  };

  const checkMatchStatus = async () => {
    if (isMatchedRef.current) return;
    try {
      const res = await fetch(`/api/match/status?sessionId=${session.token}`);
      const data = await res.json();
      if (data.status === 'matched') {
        handleMatchSuccess(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const cancelMatchmaking = async () => {
    playChime('click');
    setIsSearching(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'LEAVE_QUEUE' }));
      } catch (e) {}
      wsRef.current.close();
      wsRef.current = null;
    }
    try {
      await fetch('/api/match/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.token }),
      });
    } catch (e) {}
  };

  const pairWithSimulatedPeer = () => {
    isMatchedRef.current = true;
    setIsSearching(false);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (wsRef.current) wsRef.current.close();

    playChime('match');

    const randomPeer = SIMULATED_PEERS[Math.floor(Math.random() * SIMULATED_PEERS.length)];
    const primaryTopic = selectedInterests.length > 0 ? selectedInterests[0] : 'Engineering Review';

    const simPeer: ActivePeerInfo = {
      sessionId: `sim_${Date.now()}`,
      handle: randomPeer.handle,
      avatar: randomPeer.avatar,
      campus: randomPeer.campus,
      discipline: randomPeer.discipline,
      interests: randomPeer.interests,
      topic: primaryTopic,
      matchedAt: Date.now(),
      isSimulated: true,
    };

    onMatched(simPeer, primaryTopic, undefined, `sim_room_${Date.now()}`);
  };

  const toggleInterest = (interestLabel: string) => {
    if (isSearching) return;
    setSelectedInterests((prev) => {
      if (prev.includes(interestLabel)) {
        if (prev.length === 1) return prev;
        return prev.filter((i) => i !== interestLabel);
      } else {
        return [...prev, interestLabel];
      }
    });
  };

  const handleAddCustomInterest = (e: React.FormEvent) => {
    e.preventDefault();
    const val = customInterestInput.trim();
    if (!val) return;

    if (!selectedInterests.includes(val)) {
      setSelectedInterests((prev) => [...prev, val]);
    }
    if (!customList.includes(val)) {
      setCustomList((prev) => [...prev, val]);
    }
    setCustomInterestInput('');
    setShowCustomInput(false);
  };

  return (
    <div className="flex-1 min-h-0 w-full h-full flex flex-col justify-center items-center p-4 sm:p-6 overflow-y-auto select-none">
      <div className="w-full max-w-2xl space-y-4 my-auto">
        {/* User Identity Profile Card (Sharp corners, clean styling, no emojis/icons) */}
        <div
          className={`border p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
            isDarkMode
              ? 'bg-[#181716] border-stone-800 text-stone-100'
              : 'bg-white border-stone-300 text-stone-800'
          }`}
        >
          <div className="flex items-center space-x-3.5 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-base tracking-tight truncate text-stone-900 dark:text-white font-mono">
                  {session.sessionHandle}
                </span>
                <button
                  onClick={onRerollHandle}
                  title="Randomize Persona Handle"
                  className="p-1 border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:text-[#991B1B] dark:hover:text-[#F87171] transition-colors cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center space-x-2 mt-1 text-xs font-mono text-stone-500 dark:text-stone-400">
                <span className="truncate">{session.discipline || 'Engineering & Architecture'}</span>
                <span>•</span>
                <span className="text-[#991B1B] dark:text-[#F87171] font-semibold">
                  Mapúa Verified
                </span>
              </div>
            </div>
          </div>

          <div className="text-left sm:text-right shrink-0 text-xs border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto border-stone-200 dark:border-stone-800 font-mono">
            <span className="text-[10px] text-stone-400 block uppercase tracking-wider font-semibold">
              Authenticated Session
            </span>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {session.email}
            </span>
          </div>
        </div>

        {/* Main Interest / Topic Selection Card */}
        <div
          className={`border p-6 sm:p-7 space-y-6 shadow-xl ${
            isDarkMode
              ? 'bg-[#181716] border-stone-800 text-stone-100 shadow-stone-950/40'
              : 'bg-white border-stone-200/80 text-stone-800 shadow-stone-200/50'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-3">
            <div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-white">
                Select Your Study Topics
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Choose what you'd like to collaborate on or discuss right now
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 font-semibold text-stone-700 dark:text-stone-300">
              {selectedInterests.length} selected
            </span>
          </div>

          {/* Interests Grid */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {AVAILABLE_INTERESTS.map((interest) => {
                const isSelected = selectedInterests.includes(interest.label);
                return (
                  <button
                    key={interest.id}
                    type="button"
                    disabled={isSearching}
                    onClick={() => toggleInterest(interest.label)}
                    className={`p-3 text-xs text-left font-mono font-medium transition-colors border flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[#991B1B] text-white border-[#991B1B]'
                        : isDarkMode
                        ? 'bg-[#181716] border-stone-800 text-stone-300 hover:border-stone-600'
                        : 'bg-stone-50 border-stone-300 text-stone-700 hover:border-stone-400'
                    }`}
                  >
                    <span className="truncate">{interest.label}</span>
                    {isSelected ? (
                      <Check className="w-4 h-4 text-white shrink-0 ml-2" />
                    ) : (
                      <span className="text-stone-400 text-sm ml-2">+</span>
                    )}
                  </button>
                );
              })}

              {/* Custom Added Topics */}
              {customList.map((custom) => {
                const isSelected = selectedInterests.includes(custom);
                return (
                  <button
                    key={custom}
                    type="button"
                    disabled={isSearching}
                    onClick={() => toggleInterest(custom)}
                    className={`p-3 text-xs text-left font-mono font-medium transition-colors border flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[#991B1B] text-white border-[#991B1B]'
                        : 'bg-stone-50 dark:bg-stone-900 border-stone-300 dark:border-stone-800 text-stone-800 dark:text-stone-200'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 truncate">
                      <Hash className="w-3.5 h-3.5 text-[#991B1B] dark:text-[#F87171]" />
                      <span className="truncate">{custom}</span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-white shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>

            {/* Custom topic add input */}
            <div className="pt-1">
              {!showCustomInput ? (
                <button
                  type="button"
                  onClick={() => setShowCustomInput(true)}
                  className="px-3 py-1.5 border border-dashed border-stone-300 dark:border-stone-700 text-xs font-mono text-stone-500 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add specific course or subject code (e.g. CS102, MATH024)</span>
                </button>
              ) : (
                <form onSubmit={handleAddCustomInterest} className="flex space-x-2">
                  <input
                    type="text"
                    autoFocus
                    value={customInterestInput}
                    onChange={(e) => setCustomInterestInput(e.target.value)}
                    placeholder="e.g. CS102, PHY012, THESIS-1"
                    className={`flex-1 px-3 py-2 border text-xs font-mono focus:outline-none focus:border-[#991B1B] ${
                      isDarkMode ? 'bg-stone-900 border-stone-700 text-white' : 'bg-white border-stone-300 text-stone-900'
                    }`}
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCustomInput(false)}
                    className="px-3 py-2 border border-stone-300 dark:border-stone-700 text-xs font-mono cursor-pointer"
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
          </div>

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
                  <span>Find Mapúa Study Partner</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div className="text-[11px] font-mono text-stone-400 flex items-center justify-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#991B1B] dark:text-[#F87171]" />
                  <span>Ephemeral RAM matching • Zero logs stored • SHA-256 hashed</span>
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
                      <span>Instant Match with Mapúan AI Partner</span>
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
