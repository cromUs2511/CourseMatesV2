import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ArrowRight, LogOut, Maximize2, Minimize2, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { StudentSession, ActivePeerInfo, ChatMessage } from '../types';
import { SIMULATED_PEERS } from '../data/mockData';
import { playChime } from '../utils/sound';

interface ChatRoomProps {
  session: StudentSession;
  peer: ActivePeerInfo;
  topic: string;
  ws?: WebSocket;
  roomId?: string;
  onNextMatch: () => void;
  onLeaveChat: () => void;
  isDarkMode?: boolean;
}

export const ChatRoom: React.FC<ChatRoomProps> = ({
  session,
  peer,
  topic,
  ws,
  roomId,
  onNextMatch,
  onLeaveChat,
  isDarkMode = false,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [peerDisconnected, setPeerDisconnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Dynamic AI Suggestions state
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimestampRef = useRef<number>(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch contextual AI suggestions based on topic and recent chat
  const fetchAiSuggestions = useCallback(async (recentContextMsgs?: ChatMessage[]) => {
    setIsSuggestionsLoading(true);
    try {
      const msgsToSend = recentContextMsgs || messages.slice(-5);
      const res = await fetch('/api/ai/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          discipline: peer.discipline || session.discipline,
          campus: peer.campus || session.campus,
          recentMessages: msgsToSend.map((m) => ({
            senderHandle: m.senderHandle,
            text: m.text,
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.suggestions && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setAiSuggestions(data.suggestions);
          return;
        }
      }
      // Fallback topic suggestions
      setAiSuggestions([
        `How are you approaching your coursework in ${topic}?`,
        'Are you solving problem sets or reviewing for upcoming quizzes?',
        "What's the trickiest module or problem you've encountered so far?",
        'What study routine or notes workflow works best for you?',
      ]);
    } catch {
      setAiSuggestions([
        `How are you approaching your coursework in ${topic}?`,
        'Are you solving problem sets or reviewing for upcoming quizzes?',
        "What's the trickiest module or problem you've encountered so far?",
        'What study routine or notes workflow works best for you?',
      ]);
    } finally {
      setIsSuggestionsLoading(false);
    }
  }, [topic, peer.discipline, peer.campus, session.discipline, session.campus, messages]);

  // Initial fetch of AI suggestions on match mount
  useEffect(() => {
    fetchAiSuggestions([]);
  }, [topic]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    playChime('click');
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(() => {
        setIsFullscreen((prev) => !prev);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => {
          setIsFullscreen(false);
        }).catch(() => {
          setIsFullscreen(false);
        });
      }
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPeerTyping]);

  useEffect(() => {
    const interestStr = peer.interests && peer.interests.length > 0 ? peer.interests.join(', ') : 'General Discussion';
    setMessages([
      {
        id: 'sys-1',
        senderHandle: 'System',
        senderAvatar: '',
        isMe: false,
        text: `Connected with ${peer.handle} (${peer.campus || 'Mapúa'} Campus) • Topic: ${interestStr}. Messages exist only in RAM.`,
        timestamp: Date.now(),
        type: 'system',
      },
    ]);

    if (!peer.isSimulated && roomId) {
      if (ws) {
        const handleWsMessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'message') {
              if (data.senderHandle !== session.sessionHandle) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: data.id || `msg_${Date.now()}`,
                    senderHandle: data.senderHandle,
                    senderAvatar: '',
                    isMe: false,
                    text: data.text,
                    timestamp: data.timestamp || Date.now(),
                  },
                ]);
                playChime('message');
              }
            } else if (data.type === 'typing') {
              if (data.handle !== session.sessionHandle) {
                setIsPeerTyping(data.isTyping);
              }
            } else if (data.type === 'peer_left') {
              setPeerDisconnected(true);
              playChime('purge');
              setMessages((prev) => [
                ...prev,
                {
                  id: `sys_left_${Date.now()}`,
                  senderHandle: 'System',
                  senderAvatar: '',
                  isMe: false,
                  text: `${peer.handle} disconnected. Memory buffer cleared.`,
                  timestamp: Date.now(),
                  type: 'system',
                },
              ]);
            }
          } catch (e) {
            console.error(e);
          }
        };

        ws.addEventListener('message', handleWsMessage);
        return () => ws.removeEventListener('message', handleWsMessage);
      } else {
        pollIntervalRef.current = setInterval(async () => {
          try {
            const res = await fetch(`/api/chat/messages?roomId=${roomId}&after=${lastTimestampRef.current}`);
            const data = await res.json();
            if (data.messages && data.messages.length > 0) {
              const incoming = data.messages.filter((m: any) => m.senderHandle !== session.sessionHandle);
              if (incoming.length > 0) {
                setMessages((prev) => [
                  ...prev,
                  ...incoming.map((m: any) => ({
                    id: m.id,
                    senderHandle: m.senderHandle,
                    senderAvatar: '',
                    isMe: false,
                    text: m.text,
                    timestamp: m.timestamp,
                  })),
                ]);
                lastTimestampRef.current = data.messages[data.messages.length - 1].timestamp;
                playChime('message');
              }
            }
          } catch (e) {
            console.error(e);
          }
        }, 1500);

        return () => {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
      }
    } else if (peer.isSimulated) {
      const timer = setTimeout(() => {
        setIsPeerTyping(true);
        setTimeout(() => {
          setIsPeerTyping(false);
          const persona = SIMULATED_PEERS.find((p) => p.handle === peer.handle) || SIMULATED_PEERS[0];
          const greeting =
            persona.responseSnippets.greetings[
              Math.floor(Math.random() * persona.responseSnippets.greetings.length)
            ];
          setMessages((prev) => [
            ...prev,
            {
              id: 'sim_init',
              senderHandle: peer.handle,
              senderAvatar: '',
              isMe: false,
              text: greeting,
              timestamp: Date.now(),
            },
          ]);
          playChime('message');
        }, 1200);
      }, 600);

      return () => clearTimeout(timer);
    }
  }, [peer, roomId, ws, session.sessionHandle]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (roomId && !peer.isSimulated) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'typing',
            roomId,
            handle: session.sessionHandle,
            isTyping: true,
          })
        );
      }
      fetch('/api/chat/typing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, handle: session.sessionHandle, isTyping: true }),
      }).catch(() => {});

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'typing',
              roomId,
              handle: session.sessionHandle,
              isTyping: false,
            })
          );
        }
        fetch('/api/chat/typing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, handle: session.sessionHandle, isTyping: false }),
        }).catch(() => {});
      }, 1500);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text) return;

    setInputText('');

    let updatedMessages: ChatMessage[] = [];

    if (roomId && !peer.isSimulated) {
      const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const optimisticMsg: ChatMessage = {
        id: clientMsgId,
        senderHandle: session.sessionHandle,
        senderAvatar: '',
        isMe: true,
        text,
        timestamp: Date.now(),
      };
      updatedMessages = [...messages, optimisticMsg];
      setMessages(updatedMessages);
      playChime('click');

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'send_message',
            roomId,
            text,
            senderHandle: session.sessionHandle,
            senderAvatar: '',
          })
        );
      }

      try {
        await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            text,
            senderHandle: session.sessionHandle,
            senderAvatar: '',
          }),
        });
      } catch (err) {
        console.error('Failed to send REST message:', err);
      }
    } else {
      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        senderHandle: session.sessionHandle,
        senderAvatar: '',
        isMe: true,
        text,
        timestamp: Date.now(),
      };
      updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      playChime('click');

      if (peer.isSimulated && !peerDisconnected) {
        setTimeout(() => {
          setIsPeerTyping(true);
          setTimeout(() => {
            setIsPeerTyping(false);
            const persona = SIMULATED_PEERS.find((p) => p.handle === peer.handle) || SIMULATED_PEERS[0];
            const snippets = [
              ...persona.responseSnippets.general,
              ...persona.responseSnippets.academics,
              ...persona.responseSnippets.greetings,
            ];
            const randomReply = snippets[Math.floor(Math.random() * snippets.length)];
            setMessages((prev) => [
              ...prev,
              {
                id: `reply_${Date.now()}`,
                senderHandle: peer.handle,
                senderAvatar: '',
                isMe: false,
                text: randomReply,
                timestamp: Date.now(),
              },
            ]);
            playChime('message');
          }, 1500);
        }, 800);
      }
    }

    // Automatically shuffle and fetch new AI suggestions after a message is sent!
    fetchAiSuggestions(updatedMessages);
  };

  const handleSuggestionClick = (suggestionText: string) => {
    handleSendMessage(suggestionText);
  };

  const handleLeave = async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (roomId) {
      fetch('/api/chat/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, sessionId: session.token }),
      }).catch(() => {});
    }
    onLeaveChat();
  };

  const handleNext = async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (roomId) {
      fetch('/api/chat/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, sessionId: session.token }),
      }).catch(() => {});
    }
    onNextMatch();
  };

  return (
    <div
      className={`w-full flex-1 min-h-0 h-full flex flex-col overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 h-screen h-[100dvh] w-screen w-full' : ''
      } ${
        isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800'
      }`}
    >
      <div className="w-full flex flex-col flex-1 min-h-0 h-full overflow-hidden">
        {/* Pinned Header - Clean, solid, no user emojis/icons */}
        <div
          id="chat-header"
          className={`border-b px-4 sm:px-6 py-3 flex items-center justify-between z-10 shrink-0 ${
            isDarkMode ? 'bg-[#181716] border-stone-800' : 'bg-white border-stone-300'
          }`}
        >
          {/* Peer Info - Pure typography */}
          <div className="flex items-center space-x-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm sm:text-base truncate text-stone-900 dark:text-white">
                  {peer.handle}
                </span>
                {!peerDisconnected ? (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    ONLINE
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800">
                    LEFT
                  </span>
                )}
                <span className="text-[10px] font-mono text-stone-400 border border-stone-300 dark:border-stone-700 px-1.5 py-0.5 hidden sm:inline">
                  {peer.campus || 'Intramuros'}
                </span>
              </div>

              <div className="flex items-center space-x-1.5 text-xs font-mono text-stone-500 dark:text-stone-400 truncate mt-0.5">
                <span>{peer.discipline || 'Mapúa Engineering'}</span>
                <span>•</span>
                <span className="truncate text-[#991B1B] dark:text-[#F87171] font-semibold">{topic}</span>
              </div>
            </div>
          </div>

          {/* Controls - Solid buttons, no gradients */}
          <div className="flex items-center space-x-2">
            <button
              id="chat-fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              className="p-2 border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              id="next-match-btn"
              onClick={handleNext}
              className="py-2 px-4 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              <span>Next Peer</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              id="leave-chat-btn"
              onClick={handleLeave}
              title="Disconnect and Leave"
              className="p-2 border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Messages Area */}
        <div
          id="chat-messages-container"
          className="flex-1 min-h-0 w-full p-4 sm:p-6 overflow-y-auto overscroll-contain space-y-3 select-text"
        >
          <div className="max-w-3xl mx-auto w-full space-y-3">
            {messages.map((msg) => {
              if (msg.type === 'system') {
                return (
                  <div key={msg.id} className="my-3 text-center">
                    <div
                      className={`inline-block px-3 py-1.5 border text-xs font-mono ${
                        isDarkMode
                          ? 'bg-stone-900 border-stone-800 text-stone-400'
                          : 'bg-stone-100 border-stone-300 text-stone-600'
                      }`}
                    >
                      <span>{msg.text}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-baseline space-x-1.5 text-[11px] font-mono text-stone-400 mb-1 px-1">
                    <span className="font-semibold text-stone-600 dark:text-stone-300">
                      {msg.isMe ? 'You' : msg.senderHandle}
                    </span>
                    <span>•</span>
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Message Bubble - Solid colors, crisp borders, no AI gradient clichés */}
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] p-3.5 text-xs sm:text-sm leading-relaxed border ${
                      msg.isMe
                        ? 'bg-[#991B1B] border-[#991B1B] text-white'
                        : isDarkMode
                        ? 'bg-[#181716] border-stone-800 text-stone-100'
                        : 'bg-white border-stone-300 text-stone-900'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                  </div>
                </div>
              );
            })}

            {/* Peer Typing Indicator */}
            {isPeerTyping && (
              <div className="flex items-center space-x-2 text-xs font-mono text-stone-500 dark:text-stone-400 py-1">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-[#991B1B] animate-pulse" />
                  <div className="w-1.5 h-1.5 bg-[#991B1B] animate-pulse [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-[#991B1B] animate-pulse [animation-delay:0.4s]" />
                </div>
                <span>{peer.handle} is formulating a response...</span>
              </div>
            )}

            {/* Disconnection Banner */}
            {peerDisconnected && (
              <div className="p-4 border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-xs max-w-md mx-auto my-4 text-center space-y-2">
                <div className="flex items-center justify-center space-x-2 font-bold">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Peer disconnected from this session</span>
                </div>
                <p className="text-[11px] font-mono text-stone-500 dark:text-stone-400">
                  RAM buffer cleared. Ready for next study match.
                </p>
                <button
                  onClick={handleNext}
                  className="mt-2 px-4 py-2 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Find Next Mapúa Peer
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Dynamic AI Topic Suggestions Bar - Context aware, auto-shuffles after use */}
        {!peerDisconnected && (
          <div
            id="ai-suggestions-bar"
            className={`border-t px-4 sm:px-6 py-2 shrink-0 ${
              isDarkMode ? 'bg-[#181716] border-stone-800' : 'bg-white border-stone-300'
            }`}
          >
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
              <div className="flex items-center space-x-1.5 shrink-0 text-stone-500 dark:text-stone-400">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#991B1B] dark:text-[#F87171]">
                  AI Suggestions ({topic})
                </span>
              </div>

              {/* Shuffle button */}
              <button
                type="button"
                onClick={() => fetchAiSuggestions()}
                disabled={isSuggestionsLoading}
                title="Shuffle and generate new topic prompts"
                className="flex items-center space-x-1 px-2 py-0.5 border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-[10px] font-mono uppercase text-stone-600 dark:text-stone-300 hover:text-[#991B1B] dark:hover:text-[#F87171] transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isSuggestionsLoading ? 'animate-spin' : ''}`} />
                <span>Shuffle</span>
              </button>
            </div>

            {/* Suggestions list */}
            <div className="max-w-3xl mx-auto flex items-center space-x-2 overflow-x-auto no-scrollbar pt-1.5 pb-0.5">
              {aiSuggestions.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestionClick(prompt)}
                  title="Click to send and shuffle new ideas"
                  className={`text-[11px] font-mono px-2.5 py-1 whitespace-nowrap border transition-colors shrink-0 cursor-pointer ${
                    isDarkMode
                      ? 'bg-stone-900 border-stone-800 text-stone-300 hover:border-[#991B1B] hover:text-white'
                      : 'bg-stone-50 border-stone-300 text-stone-700 hover:border-[#991B1B] hover:text-[#991B1B]'
                  }`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Input Console */}
        <div
          id="chat-input-console"
          className={`border-t p-3 sm:p-4 shrink-0 ${
            isDarkMode ? 'bg-[#181716] border-stone-800' : 'bg-white border-stone-300'
          }`}
        >
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center space-x-2"
            >
              <input
                id="chat-message-input"
                type="text"
                autoFocus
                disabled={peerDisconnected}
                value={inputText}
                onChange={handleInputChange}
                placeholder={
                  peerDisconnected
                    ? "Session ended. Click 'Next Peer' above."
                    : `Message ${peer.handle}... (Press Enter to send)`
                }
                className={`flex-1 px-4 py-2.5 border text-xs sm:text-sm font-mono focus:outline-none focus:border-[#991B1B] disabled:opacity-50 transition-colors ${
                  isDarkMode
                    ? 'bg-stone-900 border-stone-700 text-white placeholder:text-stone-500'
                    : 'bg-stone-50 border-stone-300 text-stone-900 placeholder:text-stone-400'
                }`}
              />
              <button
                id="send-message-btn"
                type="submit"
                disabled={peerDisconnected || !inputText.trim()}
                className="py-2.5 px-5 bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-40 shrink-0 cursor-pointer flex items-center space-x-1.5"
              >
                <span>Send</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
