import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ArrowRight, LogOut, Maximize2, Minimize2, AlertTriangle, RefreshCw, Sparkles, Reply, Trash2 } from 'lucide-react';
import { StudentSession, ActivePeerInfo, ChatMessage } from '../types';
import { SIMULATED_PEERS } from '../data/mockData';
import { apiRequest } from '../utils/api';
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
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [swipe, setSwipe] = useState<{ id: string; offset: number } | null>(null);
  const touchRef = useRef<{ id: string; startX: number; startY: number; offset: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastTypingAt = useRef(0);
  const retryMessageRef = useRef<{ text: string; id: string } | null>(null);
  const endedRef = useRef(false);
  const sendingRef = useRef(false);
  const suggestionRequestRef = useRef<AbortController | null>(null);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggest = useCallback(async () => {
    suggestionRequestRef.current?.abort();
    const controller = new AbortController();
    suggestionRequestRef.current = controller;
    setIsSuggestionsLoading(true);
    try {
      // Conversation text stays in the room; topic suggestions need only the topic.
      const data = await apiRequest('/api/ai/suggestions', session.token, { topic, discipline: peer.discipline, campus: peer.campus }, controller.signal);
      if (!controller.signal.aborted) setAiSuggestions(data.suggestions.filter((s: unknown) => typeof s === 'string').slice(0, 4));
    } catch {
      if (!controller.signal.aborted) setAiSuggestions([
        'What are you working on today?', 'Which part of this topic feels trickiest?',
        'Would you like to compare study approaches?', 'What is your next study goal?',
      ]);
    } finally { if (!controller.signal.aborted) setIsSuggestionsLoading(false); }
  }, [topic, session.token, peer.discipline, peer.campus]);
  const fetchAiSuggestions = suggest;

  const receiveMessages = useCallback((incoming: any[], replace = false) => {
    if (endedRef.current) return;
    setMessages(previous => {
      const ids = new Set(previous.map(m => m.id));
      const fresh = incoming.filter(m => !ids.has(m.id)).map(m => ({
        ...m, isMe: m.senderId === session.id,
      }));
      if (replace) {
        const system = previous.filter(m => m.type === 'system');
        return [...system, ...incoming.map(m => ({ ...m, isMe: m.senderId === session.id }))].slice(-501);
      }
      return [...previous, ...fresh].slice(-501);
    });
  }, [session.id]);
  const markDisconnected = useCallback(() => {
    endedRef.current = true;
    setPeerDisconnected(true);
    setIsPeerTyping(false);
    setMessages([]);
    setInputText('');
    setError('');
  }, []);
  useEffect(() => {
    void suggest();
    return () => suggestionRequestRef.current?.abort();
  }, [suggest]);
  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setIsFullscreen(value => !value);
    } catch { setIsFullscreen(value => !value); }
  };
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isPeerTyping]);
  useEffect(() => {
    endedRef.current = false;
    setMessages([{ id: 'sys-1', senderHandle: 'System', senderAvatar: '', isMe: false,
      text: peer.isSimulated ? 'Demo conversation with a simulated study partner.' : 'Connected with ' + peer.handle + '. Messages are held in memory until this chat ends.',
      timestamp: Date.now(), type: 'system' }]);
    if (peer.isSimulated) {
      simulationTimers.current.push(setTimeout(() => {
        setMessages(previous => [...previous, {
          id: 'sim_init', senderHandle: peer.handle, senderAvatar: '', isMe: false,
          text: 'Hi! What would you like to study together today?', timestamp: Date.now(),
        }]);
      }, 800));
      return () => { simulationTimers.current.forEach(clearTimeout); simulationTimers.current = []; };
    }
    if (!roomId) return;
    let disposed = false;
    let polling = false;
    let failures = 0;
    const poll = async () => {
      if (polling || disposed || endedRef.current) return;
      polling = true;
      try {
        const data = await apiRequest('/api/chat/messages?roomId=' + encodeURIComponent(roomId), session.token);
        if (disposed || endedRef.current) return;
        failures = 0;
        if (!data.active || data.peerDisconnected) { markDisconnected(); return; }
        receiveMessages(data.messages, true);
        setIsPeerTyping(data.isPeerTyping);
        setError(current => current.startsWith('Connection interrupted') ? '' : current);
      } catch {
        if (!disposed && ++failures >= 2) setError('Connection interrupted. Retrying automatically…');
      } finally { polling = false; }
    };
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.roomId !== roomId) return;
        if (data.type === 'new_message') receiveMessages([data.message]);
        else if (data.type === 'peer_typing') {
          setIsPeerTyping(data.isTyping);
          if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
          peerTypingTimer.current = setTimeout(() => setIsPeerTyping(false), 3000);
        } else if (data.type === 'message_deleted') setMessages(previous => previous.filter(message => message.id !== data.messageId));
        else if (data.type === 'peer_disconnected') markDisconnected();
      } catch { /* REST polling repairs missed events. */ }
    };
    ws?.addEventListener('message', onMessage);
    const interval = setInterval(poll, 1500);
    void poll();
    return () => {
      disposed = true;
      clearInterval(interval);
      ws?.removeEventListener('message', onMessage);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
    };
  }, [peer, roomId, session.token, ws, receiveMessages, markDisconnected]);

  const sendTyping = (isTyping: boolean) => {
    if (roomId && !peer.isSimulated && !peerDisconnected) {
      void apiRequest('/api/chat/typing', session.token, { roomId, isTyping }).catch(() => {});
    }
  };
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value);
    if (Date.now() - lastTypingAt.current > 1000) { sendTyping(true); lastTypingAt.current = Date.now(); }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => { sendTyping(false); typingTimeoutRef.current = null; }, 1200);
  };
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputText).trim();
    if (!text || text.length > 4000 || peerDisconnected || sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setError('');
    try {
      if (peer.isSimulated) {
        receiveMessages([{ id: crypto.randomUUID(), senderId: session.id, senderHandle: session.sessionHandle, senderAvatar: '', text, timestamp: Date.now(), replyTo: replyingTo ? { id: replyingTo.id, senderHandle: replyingTo.senderHandle, text: replyingTo.text } : undefined }]);
        setIsPeerTyping(true);
        simulationTimers.current.push(setTimeout(() => {
          setIsPeerTyping(false);
          const persona = SIMULATED_PEERS.find(p => p.handle === peer.handle) || SIMULATED_PEERS[0];
          const snippets = persona.responseSnippets.academics;
          receiveMessages([{ id: crypto.randomUUID(), senderId: peer.sessionId, senderHandle: peer.handle, senderAvatar: '', text: snippets[Math.floor(Math.random() * snippets.length)], timestamp: Date.now() }]);
        }, 1500));
      } else {
        if (retryMessageRef.current?.text !== text) retryMessageRef.current = { text, id: crypto.randomUUID() };
        const data = await apiRequest('/api/chat/send', session.token, {
          roomId, text, clientMessageId: retryMessageRef.current.id,
          replyTo: replyingTo ? { id: replyingTo.id, senderHandle: replyingTo.senderHandle, text: replyingTo.text } : undefined,
        });
        receiveMessages([data.message]);
        retryMessageRef.current = null;
      }
      setInputText(current => current.trim() === text ? '' : current);
      setReplyingTo(null);
      sendTyping(false);
      playChime('message');
    } catch (err) { setError((err as Error).message); }
    finally { sendingRef.current = false; setIsSending(false); }
  };
  const handleDeleteMessage = async (message: ChatMessage) => {
    if (!message.isMe || peerDisconnected) return;
    try {
      if (peer.isSimulated) setMessages(previous => previous.filter(item => item.id !== message.id));
      else await apiRequest('/api/chat/delete', session.token, { roomId, messageId: message.id });
      setError('');
    } catch (err) { setError((err as Error).message); }
  };
  const handleSuggestionClick = (text: string) => { setInputText(text); };
  const leave = async (next: boolean) => {
    if (roomId && !peer.isSimulated) {
      try { await apiRequest('/api/chat/leave', session.token, { roomId }); } catch { /* Server lease expires when offline. */ }
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (next) onNextMatch(); else onLeaveChat();
  };
  const handleLeave = () => { void leave(false); };
  const handleNext = () => { void leave(true); };

  return (
    <div
      className={`w-full flex-1 min-h-0 h-full flex flex-col overflow-x-hidden overflow-y-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 h-screen h-[100dvh] w-screen w-full' : ''
      } ${
        isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800'
      }`}
    >
      <div className="w-full flex flex-col flex-1 min-h-0 h-full overflow-hidden">
        {/* Pinned Header - Clean, solid, no user emojis/icons */}
        <div
          id="chat-header"
          className={`border-b px-3 sm:px-6 py-2.5 sm:py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between z-10 shrink-0 ${
            isDarkMode ? 'bg-[#181716] border-stone-800' : 'bg-white border-stone-300'
          }`}
        >
          {/* Peer Info - Pure typography */}
          <div className="flex min-w-0 w-full items-center space-x-3">
            <div className="min-w-0">
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <span className="font-bold text-sm sm:text-base truncate text-stone-900 dark:text-white">
                  {peer.handle}
                </span>
                {!peerDisconnected ? (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    {peer.isSimulated ? 'DEMO' : 'CONNECTED'}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800">
                    LEFT
                  </span>
                )}
              </div>

              <div className="text-xs font-mono text-stone-500 dark:text-stone-400 truncate mt-0.5">
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
              className="flex-1 py-2 px-3 sm:flex-none sm:px-4 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
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
          className="flex-1 min-h-0 w-full p-3 sm:p-6 overflow-y-auto overscroll-contain space-y-3 select-text"
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
                  className={`group flex touch-pan-y flex-col ${msg.isMe ? 'items-end' : 'items-start'}`}
                  onTouchStart={(event) => {
                    const touch = event.touches[0];
                    if (touch) {
                      touchRef.current = { id: msg.id, startX: touch.clientX, startY: touch.clientY, offset: 0 };
                      setSwipe({ id: msg.id, offset: 0 });
                    }
                  }}
                  onTouchMove={(event) => {
                    const touch = event.touches[0];
                    const current = touchRef.current;
                    if (!touch || !current || current.id !== msg.id) return;
                    const deltaX = touch.clientX - current.startX;
                    const deltaY = touch.clientY - current.startY;
                    if (Math.abs(deltaY) > Math.abs(deltaX) || Math.abs(deltaX) < 4) return;
                    const allowedOffset = msg.isMe ? Math.min(0, deltaX) : Math.max(0, deltaX);
                    current.offset = Math.max(-96, Math.min(96, allowedOffset));
                    setSwipe({ id: msg.id, offset: current.offset });
                  }}
                  onTouchEnd={(event) => {
                    const current = touchRef.current;
                    if (!current || current.id !== msg.id) return;
                    const offset = current.offset;
                    if ((msg.isMe && offset <= -56) || (!msg.isMe && offset >= 56)) {
                      setReplyingTo(msg);
                    }
                    setSwipe(null);
                    touchRef.current = null;
                  }}
                  onTouchCancel={() => { setSwipe(null); touchRef.current = null; }}
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
                  <div className="relative max-w-[92%] sm:max-w-[75%]">
                    {swipe?.id === msg.id && swipe.offset !== 0 && (
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-mono font-semibold text-[#991B1B] dark:text-[#F87171] ${
                          msg.isMe ? 'right-full mr-2' : 'left-full ml-2'
                        }`}
                      >
                        Reply
                      </span>
                    )}
                    <div
                      className={`p-3.5 text-xs sm:text-sm leading-relaxed border transition-transform duration-150 ${
                        msg.isMe
                          ? 'bg-[#991B1B] border-[#991B1B] text-white'
                          : isDarkMode
                          ? 'bg-[#181716] border-stone-800 text-stone-100'
                          : 'bg-white border-stone-300 text-stone-900'
                      }`}
                      style={{ transform: `translateX(${swipe?.id === msg.id ? swipe.offset : 0}px)` }}
                    >
                      {msg.replyTo && (
                        <div className="mb-2 border-l-2 border-current/50 pl-2 text-[11px] opacity-75">
                          <div className="font-semibold">{msg.replyTo.senderHandle}</div>
                          <div className="truncate">{msg.replyTo.text}</div>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</p>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 px-1">
                    <button type="button" onClick={() => setReplyingTo(msg)} className="text-[10px] font-mono text-stone-400 hover:text-[#991B1B]">
                      <Reply className="inline h-3 w-3" /> Reply
                    </button>
                    {msg.isMe && <button type="button" onClick={() => void handleDeleteMessage(msg)} className="text-[10px] font-mono text-stone-400 hover:text-red-600">
                      <Trash2 className="inline h-3 w-3" /> Delete
                    </button>}
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
                <span>{peer.handle} is typing…</span>
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
                  Conversation starters
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
                  title="Use this conversation starter"
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
          className={`border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4 shrink-0 ${
            isDarkMode ? 'bg-[#181716] border-stone-800' : 'bg-white border-stone-300'
          }`}
        >
          <div className="max-w-3xl mx-auto">
            {replyingTo && (
              <div className="mb-2 flex items-center justify-between border-l-2 border-[#991B1B] bg-stone-100 px-3 py-2 text-xs dark:bg-stone-900">
                <span className="truncate">Replying to {replyingTo.senderHandle}: {replyingTo.text}</span>
                <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="ml-2 text-stone-500">×</button>
              </div>
            )}
            {error && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
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
                maxLength={4000}
                aria-label="Chat message"
                value={inputText}
                onChange={handleInputChange}
                placeholder={
                  peerDisconnected
                    ? "Session ended. Click 'Next Peer' above."
                    : `Message ${peer.handle}... (Press Enter to send)`
                }
                className={`min-w-0 flex-1 px-4 py-2.5 border text-xs sm:text-sm font-mono focus:outline-none focus:border-[#991B1B] disabled:opacity-50 transition-colors ${
                  isDarkMode
                    ? 'bg-stone-900 border-stone-700 text-white placeholder:text-stone-500'
                    : 'bg-stone-50 border-stone-300 text-stone-900 placeholder:text-stone-400'
                }`}
              />
              <button
                id="send-message-btn"
                type="submit"
                disabled={peerDisconnected || isSending || !inputText.trim()}
                className="py-2.5 px-5 bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-40 shrink-0 cursor-pointer flex items-center space-x-1.5"
              >
                <span>{isSending ? 'Sending…' : 'Send'}</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
