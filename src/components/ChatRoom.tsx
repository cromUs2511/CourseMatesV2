import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ArrowRight, LogOut, Maximize2, Minimize2, AlertTriangle, RefreshCw, Sparkles, Reply, Trash2, ChevronDown, X } from 'lucide-react';
import { StudentSession, ActivePeerInfo, ChatMessage, RoomMusicState } from '../types';
import { SIMULATED_PEERS } from '../data/mockData';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import { TopMusicBar } from './TopMusicBar';
import { MessageReactions } from './MessageReactions';
import { ChatTheme, CHAT_THEMES, ChatThemeMenu } from './ChatThemeMenu';
import { ChatAttachments } from './ChatAttachments';
import { PhotoDialog } from './PhotoDialog';
import type { ChatImage, ImageUpload } from '../data/chatImages';

const CONVERSATION_STARTER_POOL = [
  'Saan okay tumambay na may saksakan dito? My laptop\'s literally dying.',
  'May ma-recommend kang open-world sa Steam na keri lang sa laptop?',
  'Bro, do you know exactly where W405 is? Nakakaligaw yung layout minsan.',
  'Is this the right room? Baka mamaya maling class napasukan ko.',
  'Are you taking the stairs? Ang lala ng pila sa elbi eh.',
  'Do you know any cheap kainan outside Walls? Sawa na ako sa canteen.',
  'Sira ba yung myMapua niyo? I can\'t check my schedule.',
  'Wait, did the prof post the module sa Blackboard already?',
  'May groupmate ka na ba? Wala pa kasi akong kilala dito.',
  'First week pa lang pero parang midterms na, right?',
  'What\'s your next class? Baka parehas tayo ng pupuntahan.',
  'May alam kang magandang coffee shop near campus? Need to cram.',
];

const shuffleList = <T,>(items: T[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

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
  const [roomMusic, setRoomMusic] = useState<RoomMusicState>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageUpload[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const [viewingImage, setViewingImage] = useState<ChatImage | null>(null);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [peerDisconnected, setPeerDisconnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [starterPool, setStarterPool] = useState<string[]>(() => shuffleList(CONVERSATION_STARTER_POOL));
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [ambient, setAmbient] = useState({ active: false, enabled: true, color: '#e52329' });
  const [chatTheme, setChatTheme] = useState<ChatTheme>(() => {
    try {
      const saved = localStorage.getItem('coursemates_chat_theme');
      return CHAT_THEMES.find(theme => theme.id === saved) || CHAT_THEMES[0];
    } catch {
      return CHAT_THEMES[0];
    }
  });
  const [pendingAction, setPendingAction] = useState<'leave' | 'next' | null>(null);
  const [swipe, setSwipe] = useState<{ id: string; offset: number } | null>(null);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [isAtLatest, setIsAtLatest] = useState(true);
  const touchRef = useRef<{ id: string; startX: number; startY: number; offset: number } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAtLatestRef = useRef(true);
  const scrollAfterOwnMessageRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastTypingAt = useRef(0);
  const retryMessageRef = useRef<{ text: string; images: ImageUpload[]; replyId?: string; id: string } | null>(null);
  const endedRef = useRef(false);
  const sendingRef = useRef(false);
  const suggestionRequestRef = useRef<AbortController | null>(null);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAiSuggestions = useCallback(() => {
    setIsSuggestionsLoading(true);
    setStarterPool(current => shuffleList(current.length ? current : CONVERSATION_STARTER_POOL));
  }, []);

  useEffect(() => {
    const nextSuggestions = shuffleList(starterPool).slice(0, 3);
    setAiSuggestions(nextSuggestions);
    setIsSuggestionsLoading(false);
  }, [starterPool]);

  const receiveMessages = useCallback((incoming: any[], replace = false) => {
    if (endedRef.current) return;
    setMessages(previous => {
      const ids = new Set(previous.map(m => m.id));
      const fresh = incoming.filter(m => !ids.has(m.id)).map(m => ({
        ...m, isMe: m.senderId === session.id,
      }));
      const newPeerMessages = fresh.filter(message => !message.isMe);
      if (!isAtLatestRef.current && newPeerMessages.length > 0) {
        setUnreadMessageCount(count => count + newPeerMessages.length);
      }
      if (!replace && newPeerMessages.length > 0) playChime('message');
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
    setPendingImages([]);
    setViewingImage(null);
    setReplyingTo(null);
    retryMessageRef.current = null;
    setError('');
  }, []);
  useEffect(() => {
    if (viewingImage && !messages.some(message => message.images?.some(image => image.id === viewingImage.id))) setViewingImage(null);
  }, [messages, viewingImage]);
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
  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const atLatest = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
    isAtLatestRef.current = atLatest;
    setIsAtLatest(atLatest);
    if (atLatest) setUnreadMessageCount(0);
  };
  const scrollToLatest = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    isAtLatestRef.current = true;
    setIsAtLatest(true);
    setUnreadMessageCount(0);
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  };
  useEffect(() => {
    if (!scrollAfterOwnMessageRef.current) return;
    scrollAfterOwnMessageRef.current = false;
    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [messages]);
  useEffect(() => {
    endedRef.current = false;
    setMessages([{ id: 'sys-1', senderHandle: 'System', senderAvatar: '', isMe: false,
      text: peer.isSimulated ? 'Demo conversation with a simulated study partner.' : 'Connected with ' + peer.handle + '. Messages are held in memory until this chat ends.',
      timestamp: Date.now(), type: 'system' }]);
    if (peer.isSimulated) {
      simulationTimers.current.push(setTimeout(() => {
        receiveMessages([{
          id: 'sim_init', senderHandle: peer.handle, senderAvatar: '', isMe: false,
          text: 'Hi! What would you like to study together today?', timestamp: Date.now(),
        }]);
      }, 800));
      return () => {
        simulationTimers.current.forEach(clearTimeout);
        simulationTimers.current = [];
      };
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
        setRoomMusic(data.music);
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
        else if (data.type === 'message_reactions') setMessages(previous => previous.map(message => message.id === data.messageId ? { ...message, reactions: data.reactions } : message));
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
    const images = pendingImages;
    const replyTo = replyingTo ? { id: replyingTo.id, senderHandle: replyingTo.senderHandle, text: replyingTo.text || 'Photo' } : undefined;
    if ((!text && !images.length) || text.length > 4000 || peerDisconnected || sendingRef.current || preparingImages) return;
    sendingRef.current = true;
    setIsSending(true);
    setError('');
    try {
      if (peer.isSimulated) {
        scrollAfterOwnMessageRef.current = true;
        receiveMessages([{ id: crypto.randomUUID(), senderId: session.id, senderHandle: session.sessionHandle, senderAvatar: '', text,
          images: images.map(image => ({ id: crypto.randomUUID(), name: image.name, url: image.dataUrl, width: image.width, height: image.height })),
          timestamp: Date.now(), replyTo }]);
        setIsPeerTyping(true);
        simulationTimers.current.push(setTimeout(() => {
          setIsPeerTyping(false);
          const persona = SIMULATED_PEERS.find(p => p.handle === peer.handle) || SIMULATED_PEERS[0];
          const snippets = persona.responseSnippets.academics;
          receiveMessages([{ id: crypto.randomUUID(), senderId: peer.sessionId, senderHandle: peer.handle, senderAvatar: '', text: snippets[Math.floor(Math.random() * snippets.length)], timestamp: Date.now() }]);
        }, 1500));
      } else {
        if (retryMessageRef.current?.text !== text || retryMessageRef.current?.images !== images || retryMessageRef.current?.replyId !== replyTo?.id) {
          retryMessageRef.current = { text, images, replyId: replyTo?.id, id: crypto.randomUUID() };
        }
        const data = await apiRequest('/api/chat/send', session.token, {
          roomId, text, images, clientMessageId: retryMessageRef.current.id, replyTo,
        });
        if (endedRef.current) return;
        scrollAfterOwnMessageRef.current = true;
        receiveMessages([data.message]);
        retryMessageRef.current = null;
      }
      setInputText(current => current.trim() === text ? '' : current);
      setPendingImages(current => current === images ? [] : current);
      setReplyingTo(null);
      sendTyping(false);
      playChime('message');
    } catch (err) { setError((err as Error).message); }
    finally { sendingRef.current = false; setIsSending(false); }
  };
  const handleReact = async (messageId: string, emoji: string | null) => {
    if (peerDisconnected) return;
    try {
      if (peer.isSimulated) {
        setMessages(previous => previous.map(message => {
          if (message.id !== messageId) return message;
          const reactions = { ...message.reactions };
          if (emoji === null) delete reactions[session.id];
          else reactions[session.id] = emoji;
          return { ...message, reactions };
        }));
      } else {
        const data = await apiRequest('/api/chat/react', session.token, { roomId, messageId, emoji });
        setMessages(previous => previous.map(message => message.id === messageId ? { ...message, reactions: data.reactions } : message));
      }
      setError('');
    } catch (err) { setError((err as Error).message); }
  };
  const handleDeleteMessage = async (message: ChatMessage) => {
    if (!message.isMe || peerDisconnected) return;
    try {
      if (peer.isSimulated) setMessages(previous => previous.filter(item => item.id !== message.id));
      else await apiRequest('/api/chat/delete', session.token, { roomId, messageId: message.id });
      setError('');
    } catch (err) { setError((err as Error).message); }
  };
  const handleSuggestionClick = (text: string) => {
    setInputText(text);
    setStarterPool(current => current.filter((prompt) => prompt !== text));
  };
  const leave = async (next: boolean) => {
    if (roomId && !peer.isSimulated) {
      try { await apiRequest('/api/chat/leave', session.token, { roomId }); } catch { /* Server lease expires when offline. */ }
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (next) onNextMatch(); else onLeaveChat();
  };
  const requestLeave = () => setPendingAction('leave');
  const requestNext = () => setPendingAction('next');
  const confirmPendingAction = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action) void leave(action === 'next');
  };
  const handleAmbientChange = useCallback((next: { active: boolean; enabled: boolean; color: string }) => {
    setAmbient(current => current.active === next.active && current.enabled === next.enabled && current.color === next.color ? current : next);
  }, []);
  const ambientActive = ambient.active && ambient.enabled;
  const updateChatTheme = (next: ChatTheme) => {
    setChatTheme(next);
    try {
      localStorage.setItem('coursemates_chat_theme', next.id);
    } catch {
      // Storage may be unavailable in private browsers.
    }
  };

  return (
    <div
      className={`relative w-full flex-1 min-h-0 h-full flex flex-col overflow-x-hidden overflow-y-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 h-screen h-[100dvh] w-screen w-full' : ''
      } ${isDarkMode ? 'text-stone-100' : 'text-stone-800'}`}
      style={{ backgroundColor: isDarkMode ? chatTheme.darkBackground : chatTheme.lightBackground }}
    >
      {ambientActive && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 animate-ambient-glow"
            style={{
              background: `
                radial-gradient(circle at 50% 42%, ${ambient.color}65 0%, ${ambient.color}28 28%, transparent 66%),
                radial-gradient(ellipse at 8% 90%, ${ambient.color}38, transparent 52%),
                radial-gradient(ellipse at 92% 12%, ${ambient.color}32, transparent 48%)
              `,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-12%] z-0 animate-ambient-glow-drift"
            style={{
              background: `radial-gradient(ellipse at 50% 50%, transparent 30%, ${ambient.color}30 68%, transparent 82%)`,
            }}
          />
          <div
            aria-hidden="true"
            className="ambient-spectrum"
            style={{ '--spectrum-color': ambient.color } as React.CSSProperties}
          >
            {Array.from({ length: 24 }, (_, index) => (
              <span key={index} className="ambient-spectrum-bar" />
            ))}
          </div>
        </>
      )}
      <div className="relative w-full flex flex-col flex-1 min-h-0 h-full overflow-visible">
        {/* Pinned Header - Clean, solid, no user emojis/icons */}
        <div
          id="chat-header"
          className={`border-b px-3 sm:px-6 py-1.5 sm:py-3 flex flex-row items-center justify-between gap-2 z-10 shrink-0 ${
            isDarkMode ? 'bg-black/20 border-stone-800' : 'bg-white/75 border-stone-300'
          }`}
        >
          {/* Peer Info - Pure typography */}
          <div className="flex min-w-0 flex-1 items-center space-x-2">
            <div className="min-w-0">
              <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 sm:w-auto">
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
                <span className="truncate font-semibold" style={{ color: chatTheme.accent }}>{topic}</span>
              </div>

            </div>
          </div>

          {/* Controls - Solid buttons, no gradients */}
          <div className="flex shrink-0 items-center space-x-1.5 sm:space-x-2">
            {!peerDisconnected && <TopMusicBar isDarkMode={isDarkMode} roomId={roomId} ws={ws} token={session.token} remoteMusic={roomMusic} isSimulated={peer.isSimulated} onAmbientChange={handleAmbientChange} />}
            <ChatThemeMenu theme={chatTheme} onChange={updateChatTheme} isDarkMode={isDarkMode} />
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
              onClick={requestNext}
              className="flex-none py-2 px-2 sm:px-4 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <span className="next-peer-label">Next Peer</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

          </div>
        </div>
        {/* Scrollable Messages Area */}
        <div
          id="chat-messages-container"
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 min-h-0 w-full p-3 sm:p-6 overflow-y-auto overscroll-contain space-y-3 select-text"
        >
          <div className="max-w-3xl mx-auto w-full space-y-3">
            {messages.map((msg) => {
              if (msg.type === 'system') {
                return (
                  <div key={msg.id} className="my-3 text-center">
                    <div
                      className={`inline-block rounded-xl px-3 py-1.5 border text-xs font-mono ${
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
                    <MessageReactions reactions={msg.reactions} sessionId={session.id} onReact={emoji => handleReact(msg.id, emoji)}>
                    <div
                      className={`rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed border transition-transform duration-150 ${
                        msg.isMe
                          ? 'text-white'
                          : isDarkMode
                          ? 'bg-black/20 border-stone-800 text-stone-100'
                          : 'bg-white/75 border-stone-300 text-stone-900'
                      }`}
                      style={{
                      transform: `translateX(${swipe?.id === msg.id ? swipe.offset : 0}px)`,
                      ...(msg.isMe ? { backgroundColor: chatTheme.accent, borderColor: chatTheme.accent } : {}),
                      }}
                    >
                      {msg.replyTo && (
                        <div className="mb-2 border-l-2 border-current/50 pl-2 text-[11px] opacity-75">
                          <div className="font-semibold">{msg.replyTo.senderHandle}</div>
                          <div className="truncate">{msg.replyTo.text}</div>
                        </div>
                      )}
                      {!!msg.images?.length && <div className={`grid gap-2 ${msg.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${msg.text ? 'mb-2' : ''}`}>
                        {msg.images.map(image => <button key={image.id} type="button" onClick={() => setViewingImage(image)} aria-label={'View photo ' + image.name}
                          className="block overflow-hidden rounded-lg bg-black/10">
                          <img src={image.url} alt={image.name} width={image.width} height={image.height}
                            className="max-h-64 w-full max-w-80 object-contain" loading="lazy" draggable={false} />
                        </button>)}
                      </div>}
                      {msg.text && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</p>}
                    </div>
                    </MessageReactions>
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
                  onClick={requestNext}
                  className="mt-2 px-4 py-2 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Find Next Mapúa Peer
                </button>
              </div>
            )}

          </div>
          {!isAtLatest && (
            <button
              type="button"
              onClick={scrollToLatest}
              aria-label="Scroll to latest messages"
              className={`sticky bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg transition-colors ${
                isDarkMode
                  ? 'border-stone-700 bg-stone-900 text-stone-100 hover:bg-stone-800'
                  : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-50'
              }`}
            >
              <ChevronDown className="h-4 w-4" />
              {unreadMessageCount > 0 ? `${unreadMessageCount} new message${unreadMessageCount === 1 ? '' : 's'}` : 'Latest messages'}
            </button>
          )}
        </div>

        {/* Dynamic AI Topic Suggestions Bar - Context aware, auto-shuffles after use */}
        {!peerDisconnected && aiSuggestions.length > 0 && (
          <div
            id="ai-suggestions-bar"
            className={`border-t px-4 sm:px-6 py-2 shrink-0 ${
            isDarkMode ? 'bg-black/15 border-stone-800' : 'bg-white/75 border-stone-300'
            }`}
          >
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
              <div className="flex items-center space-x-1.5 shrink-0 text-stone-500 dark:text-stone-400">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color: chatTheme.accent }}>
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
            isDarkMode ? 'bg-black/15 border-stone-800' : 'bg-white/75 border-stone-300'
          }`}
        >
          <div className="max-w-3xl mx-auto">
            {replyingTo && (
              <div className="mb-2 flex items-center justify-between border-l-2 border-[#991B1B] bg-stone-100 px-3 py-2 text-xs dark:bg-stone-900">
                <span className="truncate">Replying to {replyingTo.senderHandle}: {replyingTo.text || 'Photo'}</span>
                <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="ml-2 text-stone-500">×</button>
              </div>
            )}
            {error && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {preparingImages && <p role="status" className="mb-2 text-xs text-stone-500">Preparing photos…</p>}
            {pendingImages.length > 0 && <div aria-label="Photo attachments" className="mb-2 flex gap-2 overflow-x-auto py-1">
              {pendingImages.map((image, index) => <div key={index} className="relative shrink-0">
                <img src={image.dataUrl} alt={'Preview of ' + image.name} className="h-16 w-16 rounded-lg border border-stone-300 object-cover dark:border-stone-700" />
                <button type="button" disabled={isSending || preparingImages} onClick={() => setPendingImages(current => current.filter((_, position) => position !== index))}
                  aria-label={'Remove photo ' + image.name} className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white shadow disabled:opacity-40"><X className="h-3 w-3" /></button>
              </div>)}
            </div>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center space-x-2"
            >
              <ChatAttachments images={pendingImages} onChange={setPendingImages} disabled={peerDisconnected || isSending} onError={setError} onBusyChange={setPreparingImages} />
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
                    : pendingImages.length ? 'Add a caption…' : `Message ${peer.handle}... (Press Enter to send)`
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
                aria-label={isSending ? 'Sending message' : 'Send message'}
                disabled={peerDisconnected || isSending || preparingImages || (!inputText.trim() && !pendingImages.length)}
                className="py-2.5 px-3 sm:px-5 bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-40 shrink-0 cursor-pointer flex items-center space-x-1.5"
              >
                <span>{isSending ? 'Sending…' : 'Send'}</span>
                <Send className="w-3.5 h-3.5" />
              </button>
              {!peerDisconnected && (
                <button
                  id="leave-chat-btn"
                  type="button"
                  onClick={requestLeave}
                  aria-label="Disconnect and leave chat"
                  title="Disconnect and leave chat"
                  className={`flex h-10 w-10 shrink-0 items-center justify-center border transition-colors ${
                    isDarkMode
                      ? 'border-stone-700 bg-stone-900 text-stone-300 hover:border-red-400 hover:text-red-400'
                      : 'border-stone-300 bg-stone-50 text-stone-600 hover:border-red-600 hover:text-red-600'
                  }`}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
      {viewingImage && <PhotoDialog title="Photo" onClose={() => setViewingImage(null)}>
        <img src={viewingImage.url} alt={viewingImage.name} className="mx-auto max-h-[70dvh] max-w-full rounded-lg object-contain" />
      </PhotoDialog>}
      {pendingAction && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-action-confirm-title"
            className={`w-full max-w-sm rounded-xl border p-5 shadow-2xl ${
            isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-100' : 'border-stone-300 bg-white text-stone-900'
            }`}
          >
            <h2 id="chat-action-confirm-title" className="text-base font-semibold">
            {pendingAction === 'next' ? 'Find another peer?' : 'Leave this chat?'}
            </h2>
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            {pendingAction === 'next'
              ? 'This conversation will end before searching for a new match.'
              : 'This conversation will end and its messages will be cleared.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setPendingAction(null)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs dark:border-stone-700">
              Cancel
            </button>
            <button type="button" onClick={confirmPendingAction} className="rounded-lg bg-[#991B1B] px-3 py-2 text-xs font-semibold text-white">
              {pendingAction === 'next' ? 'Find next peer' : 'Disconnect'}
            </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
