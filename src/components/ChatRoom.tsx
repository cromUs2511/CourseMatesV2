import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Send, ArrowLeft, LogOut, Maximize2, Minimize2, AlertTriangle, RefreshCw, Sparkles, Reply, Trash2, Copy, MoreVertical, ChevronDown, X, Pencil, Music2 } from 'lucide-react';
import { StudentSession, ActivePeerInfo, ChatMessage, RoomMusicState } from '../types';
import { apiRequest } from '../utils/api';
import { playChime } from '../utils/sound';
import { reconcileMessageSnapshot } from '../utils/chatMessages';
import { Header, type HeaderProps } from './Header';
import { AmbientAurora } from './AmbientAurora';
import { SpiderWebBackground } from './SpiderWebBackground';
import { TopMusicBar } from './TopMusicBar';
import { MessageReactions } from './MessageReactions';
import { ChatThemeMenu, type ChatTheme } from './ChatThemeMenu';
import { ThemeToggle } from './ThemeToggle';
import { ChatAttachments } from './ChatAttachments';
import { PhotoDialog, ZoomablePhoto } from './PhotoDialog';
import { VoiceRecorder } from './VoiceRecorder';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { MusicSnippetPicker } from './MusicSnippetPicker';
import { MusicSnippetCard } from './MusicSnippetCard';
import type { MusicSnippet } from '../data/musicSnippet';
import type { ChatImage, ImageUpload } from '../data/chatImages';
import type { VoiceUpload } from '../data/chatVoice';
import { MESSAGE_REACTIONS } from '../data/reactions';

const STUDENT_CHATBOT_NAME = 'Student Chatbot Assistant';
const CONVERSATION_STARTER_LIMIT = 3;
const messageTimeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const formatVoiceDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const CONVERSATION_STARTER_POOL = [
  'Saan okay tumambay na may saksakan dito? My laptop\'s literally dying.',
  'May ma-recommend kang open-world sa Steam na keri lang sa laptop?',
  'Bro, do you know exactly where W405 is? Nakakaligaw yung layout minsan.',
  'Is this the right room? Baka mamaya maling class napasukan ko.',
  'Are you taking the stairs? Ang lala ng pila sa elbi eh.',
  'Do you know any cheap kainan outside Walls? Sawa na ako sa canteen.',
  'Sira ba yung student portal niyo? I can\'t check my schedule.',
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
  headerProps: HeaderProps;
  chatTheme: ChatTheme;
  onChatThemeChange: (theme: ChatTheme) => void;
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
  headerProps,
  chatTheme,
  onChatThemeChange,
}) => {
  const [roomMusic, setRoomMusic] = useState<RoomMusicState>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasInputText, setHasInputText] = useState(false);
  const [pendingImages, setPendingImages] = useState<ImageUpload[]>([]);
  const [pendingVoice, setPendingVoice] = useState<VoiceUpload | null>(null);
  const [preparingImages, setPreparingImages] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [viewingImage, setViewingImage] = useState<ChatImage | null>(null);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [peerDisconnected, setPeerDisconnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [composerEngaged, setComposerEngaged] = useState(false);
  const [musicPickerOpen, setMusicPickerOpen] = useState(false);
  const [activeSnippetId, setActiveSnippetId] = useState<string | null>(null);
  const [snippetPlaying, setSnippetPlaying] = useState(false);
  const [starterPool, setStarterPool] = useState<string[]>(() => shuffleList(CONVERSATION_STARTER_POOL));
  const [startersSent, setStartersSent] = useState(0);
  const [selectedStarter, setSelectedStarter] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [deleteMenuMessageId, setDeleteMenuMessageId] = useState<string | null>(null);
  const [messageActionsPosition, setMessageActionsPosition] = useState<{ left: number; top: number } | null>(null);
  const messageBubbleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [ambient, setAmbient] = useState<{ active: boolean; enabled: boolean; color: string; effect: 'aurora' | 'spider-web' }>({ active: false, enabled: true, color: '#6ee7b7', effect: 'aurora' });
  const [pendingAction, setPendingAction] = useState<'leave' | 'next' | null>(null);
  const [swipe, setSwipe] = useState<{ id: string; offset: number } | null>(null);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [isAtLatest, setIsAtLatest] = useState(true);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const touchRef = useRef<{ id: string; startX: number; startY: number; offset: number; axis: 'x' | 'y' | null } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const isAtLatestRef = useRef(true);
  const scrollAfterOwnMessageRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingAt = useRef(0);
  const retryMessageRef = useRef<{ text: string; images: ImageUpload[]; voice: VoiceUpload | null; replyId?: string; id: string } | null>(null);
  const endedRef = useRef(false);
  const sendingRef = useRef(false);
  const receivedMessageIds = useRef(new Set<string>());
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRevisionRef = useRef<number | null>(null);

  const fetchAiSuggestions = useCallback(() => {
    setIsSuggestionsLoading(true);
    setStarterPool(current => shuffleList(current.length ? current : CONVERSATION_STARTER_POOL));
  }, []);

  useEffect(() => {
    const nextSuggestions = shuffleList(starterPool).slice(0, CONVERSATION_STARTER_LIMIT - startersSent);
    setAiSuggestions(nextSuggestions);
    setIsSuggestionsLoading(false);
  }, [starterPool, startersSent]);

  const receiveMessages = useCallback((incoming: any[], replace = false) => {
    if (endedRef.current) return;
    setMessages(previous => {
      if (replace) return reconcileMessageSnapshot(previous, incoming, session.id);
      const ids = new Set(previous.map(m => m.id));
      const fresh = incoming.filter(m => !ids.has(m.id)).map(m => ({
        ...m, isMe: m.senderId === session.id,
      }));
      return fresh.length ? [...previous, ...fresh].slice(-501) : previous;
    });
  }, [session.id]);
  const markDisconnected = useCallback(() => {
    endedRef.current = true;
    setPeerDisconnected(true);
    setIsPeerTyping(false);
    setMessages([]);
    if (inputRef.current) inputRef.current.value = '';
    setHasInputText(false);
    setComposerEngaged(false);
    setPendingImages([]);
    setPendingVoice(null);
    setViewingImage(null);
    setMusicPickerOpen(false);
    setActiveSnippetId(null);
    setSnippetPlaying(false);
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
  useEffect(() => {
    if (!composerEngaged) return;
    const collapse = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) setComposerEngaged(false);
    };
    document.addEventListener('pointerdown', collapse);
    return () => document.removeEventListener('pointerdown', collapse);
  }, [composerEngaged]);
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
  const scrollToRepliedMessage = (messageId: string) => {
    const target = messageBubbleRefs.current[messageId];
    if (!target) {
      setError('The original message is no longer available.');
      return;
    }
    setError('');
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
    setHighlightedMessageId(messageId);
    if (replyHighlightTimerRef.current) clearTimeout(replyHighlightTimerRef.current);
    replyHighlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 1600);
  };
  useEffect(() => () => {
    if (replyHighlightTimerRef.current) clearTimeout(replyHighlightTimerRef.current);
  }, []);
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    let frame = 0;
    const keepLatestVisible = () => {
      if (!isAtLatestRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepLatestVisible);
    observer?.observe(container);
    window.visualViewport?.addEventListener('resize', keepLatestVisible);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.visualViewport?.removeEventListener('resize', keepLatestVisible);
    };
  }, []);
  useEffect(() => {
    const freshPeerMessages = messages.filter(message => !message.isMe && message.type !== 'system' && !receivedMessageIds.current.has(message.id));
    receivedMessageIds.current = new Set(messages.map(message => message.id));
    if (freshPeerMessages.length) {
      if (!isAtLatestRef.current) setUnreadMessageCount(count => count + freshPeerMessages.length);
      playChime('message');
    }
    if (!isAtLatestRef.current && !scrollAfterOwnMessageRef.current) return;
    scrollAfterOwnMessageRef.current = false;
    const frame = requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      isAtLatestRef.current = true;
      setIsAtLatest(true);
      setUnreadMessageCount(0);
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);
  useEffect(() => {
    if (!isPeerTyping || !isAtLatestRef.current) return;
    const frame = requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [isPeerTyping]);
  useEffect(() => {
    endedRef.current = false;
    snapshotRevisionRef.current = null;
    setMessages([{ id: 'sys-1', senderHandle: 'System', senderAvatar: '', isMe: false,
      text: peer.isSimulated ? 'Conversation with the Student Chatbot Assistant.' : 'Connected with ' + peer.handle + '. Messages are held in memory until this chat ends.',
      timestamp: Date.now(), type: 'system' }]);
    if (peer.isSimulated) return;
    if (!roomId) return;
    let disposed = false;
    let polling = false;
    let failures = 0;
    const poll = async () => {
      if (polling || disposed || endedRef.current) return;
      polling = true;
      try {
        const revisionQuery = snapshotRevisionRef.current === null ? '' : '&sinceRevision=' + snapshotRevisionRef.current;
        const data = await apiRequest('/api/chat/messages?roomId=' + encodeURIComponent(roomId) + revisionQuery, session.token);
        if (disposed || endedRef.current) return;
        failures = 0;
        if (!data.active || data.peerDisconnected) { markDisconnected(); return; }
        if (Number.isInteger(data.revision)) {
          // A poll may have started before a newer WebSocket event arrived. Never
          // let that older snapshot temporarily remove and then re-add a message.
          if (snapshotRevisionRef.current !== null && data.revision < snapshotRevisionRef.current) return;
          snapshotRevisionRef.current = data.revision;
        }
        setRoomMusic(current => current?.revision === data.music?.revision ? current : data.music);
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
        if (Number.isInteger(data.revision)) {
          if (snapshotRevisionRef.current !== null && data.revision <= snapshotRevisionRef.current) return;
          snapshotRevisionRef.current = data.revision;
        }
        if (data.type === 'new_message') receiveMessages([data.message]);
        else if (data.type === 'message_reactions') setMessages(previous => previous.map(message => message.id === data.messageId ? { ...message, reactions: data.reactions } : message));
        else if (data.type === 'message_edited') setMessages(previous => previous.map(message => message.id === data.message.id ? { ...message, ...data.message, isMe: message.isMe || data.message.senderId === session.id, edited: true } : message));
        else if (data.type === 'peer_typing') {
          setIsPeerTyping(data.isTyping);
          if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
          peerTypingTimer.current = setTimeout(() => setIsPeerTyping(false), 3000);
        }         else if (data.type === 'message_unsent') setMessages(previous => previous.map(message => message.id === data.messageId
          ? { ...message, type: 'system', text: 'Message unsent.', images: undefined, voice: undefined, musicSnippet: undefined, reactions: undefined, replyTo: undefined }
          : message));
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
    const hasText = Boolean(event.target.value.trim());
    setHasInputText(current => current === hasText ? current : hasText);
    if (!event.target.value.trim()) setSelectedStarter(null);
    if (Date.now() - lastTypingAt.current > 1000) { sendTyping(true); lastTypingAt.current = Date.now(); }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => { sendTyping(false); typingTimeoutRef.current = null; }, 1200);
  };
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputRef.current?.value ?? '').trim();
    const images = pendingImages;
    const voice = pendingVoice;
    const replyTo = replyingTo ? { id: replyingTo.id, senderHandle: replyingTo.senderHandle, text: replyingTo.text || (replyingTo.voice ? 'Voice message' : 'Image') } : undefined;
    if ((!text && !images.length && !voice) || text.length > 4000 || peerDisconnected || sendingRef.current || preparingImages || isRecordingVoice) return;
    sendingRef.current = true;
    setIsSending(true);
    setError('');
    try {
      if (peer.isSimulated) {
        scrollAfterOwnMessageRef.current = true;
        const userMessage = { id: crypto.randomUUID(), senderId: session.id, senderHandle: session.sessionHandle, senderAvatar: '', text,
          images: images.map(image => ({ id: crypto.randomUUID(), name: image.name, url: image.dataUrl, width: image.width, height: image.height })),
          ...(voice ? { voice: { id: crypto.randomUUID(), url: voice.dataUrl, duration: voice.duration, mimeType: voice.dataUrl.slice(5, voice.dataUrl.indexOf(';')) } } : {}),
          timestamp: Date.now(), replyTo, isMe: true };
        receiveMessages([userMessage]);
        if (inputRef.current?.value.trim() === text) {
          inputRef.current.value = '';
          setHasInputText(false);
          inputRef.current.blur();
          setComposerEngaged(false);
        }
        if (selectedStarter && startersSent < CONVERSATION_STARTER_LIMIT) {
          setStartersSent(count => Math.min(count + 1, CONVERSATION_STARTER_LIMIT));
          setStarterPool(current => current.filter(prompt => prompt !== selectedStarter));
          setSelectedStarter(null);
        }
        setPendingImages(current => current === images ? [] : current);
        setPendingVoice(current => current === voice ? null : current);
        setReplyingTo(null);
        sendTyping(false);
        playChime('message');
        setIsPeerTyping(true);
        const data = await apiRequest<{ reply: string }>('/api/ai/chatbot', session.token, {
          message: text || (voice ? 'I shared a voice message.' : 'I shared an image. Ask me to describe what I would like help with.'),
          topic,
          history: messages
            .filter(message => message.type !== 'system' && message.text.trim())
            .slice(-12)
            .map(message => ({ role: message.isMe ? 'user' : 'assistant', text: message.text })),
        });
        if (endedRef.current) return;
        setIsPeerTyping(false);
        receiveMessages([{
          id: crypto.randomUUID(),
          senderId: peer.sessionId,
          senderHandle: STUDENT_CHATBOT_NAME,
          senderAvatar: '',
          isMe: false,
          text: data.reply,
          timestamp: Date.now(),
        }]);
        return;
      } else {
        if (retryMessageRef.current?.text !== text || retryMessageRef.current?.images !== images || retryMessageRef.current?.voice !== voice || retryMessageRef.current?.replyId !== replyTo?.id) {
          retryMessageRef.current = { text, images, voice, replyId: replyTo?.id, id: crypto.randomUUID() };
        }
        const data = await apiRequest('/api/chat/send', session.token, {
          roomId, text, images, voice, clientMessageId: retryMessageRef.current.id, replyTo,
        });
        if (endedRef.current) return;
        scrollAfterOwnMessageRef.current = true;
        receiveMessages([data.message]);
        retryMessageRef.current = null;
      }
      if (inputRef.current?.value.trim() === text) {
        inputRef.current.value = '';
        setHasInputText(false);
        inputRef.current.blur();
        setComposerEngaged(false);
      }
      if (selectedStarter && startersSent < CONVERSATION_STARTER_LIMIT) {
        setStartersSent(count => Math.min(count + 1, CONVERSATION_STARTER_LIMIT));
        setStarterPool(current => current.filter(prompt => prompt !== selectedStarter));
        setSelectedStarter(null);
      }
      setPendingImages(current => current === images ? [] : current);
      setPendingVoice(current => current === voice ? null : current);
      setReplyingTo(null);
      sendTyping(false);
      playChime('message');
    } catch (err) {
      setIsPeerTyping(false);
      setError((err as Error).message);
    }
    finally { sendingRef.current = false; setIsSending(false); }
  };
  const handleSendMusicSnippet = async (musicSnippet: MusicSnippet) => {
    if (peerDisconnected || sendingRef.current) throw new Error('Chat is unavailable right now.');
    sendingRef.current = true;
    setIsSending(true);
    setError('');
    const replyTo = replyingTo ? { id: replyingTo.id, senderHandle: replyingTo.senderHandle, text: replyingTo.text || (replyingTo.musicSnippet ? `Music: ${replyingTo.musicSnippet.title}` : replyingTo.voice ? 'Voice message' : 'Image') } : undefined;
    try {
      if (peer.isSimulated) {
        receiveMessages([{ id: crypto.randomUUID(), senderId: session.id, senderHandle: session.sessionHandle, senderAvatar: '', text: musicSnippet.caption, musicSnippet, timestamp: Date.now(), replyTo, isMe: true }]);
      } else {
        const data = await apiRequest<{ message: ChatMessage }>('/api/chat/send', session.token, { roomId, text: '', musicSnippet, clientMessageId: crypto.randomUUID(), replyTo });
        if (endedRef.current) return;
        receiveMessages([data.message]);
      }
      scrollAfterOwnMessageRef.current = true;
      setReplyingTo(null);
      setMusicPickerOpen(false);
      sendTyping(false);
      playChime('message');
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
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
      if (peer.isSimulated) {
        setMessages(previous => previous.map(item => item.id === message.id
          ? { ...item, type: 'system', text: 'Message unsent.', images: undefined, voice: undefined, musicSnippet: undefined, reactions: undefined, replyTo: undefined }
          : item));
      } else {
        const data = await apiRequest<{ message: ChatMessage }>('/api/chat/delete', session.token, { roomId, messageId: message.id });
        setMessages(previous => previous.map(item => item.id === message.id ? { ...data.message, isMe: true } : item));
      }
      setDeleteMenuMessageId(null);
      setError('');
    } catch (err) { setError((err as Error).message); }
  };
  const handleEditMessage = async () => {
    const messageId = editingMessageId;
    const text = (inputRef.current?.value ?? '').trim();
    if (!messageId || !text || peerDisconnected || sendingRef.current || preparingImages) return;
    try {
      if (peer.isSimulated) {
        setMessages(previous => previous.map(message => message.id === messageId ? { ...message, text, edited: true } : message));
      } else {
        const data = await apiRequest<{ message: ChatMessage }>('/api/chat/edit', session.token, { roomId, messageId, text });
        setMessages(previous => previous.map(message => message.id === messageId ? { ...message, ...data.message, isMe: true } : message));
      }
      if (inputRef.current) {
        inputRef.current.value = '';
        setHasInputText(false);
      }
      setEditingMessageId(null);
      setError('');
      sendTyping(false);
    } catch (err) { setError((err as Error).message); }
    finally { setIsSending(false); }
  };
  const openMessageActions = (messageId: string) => {
    const box = messageBubbleRefs.current[messageId]?.getBoundingClientRect();
    if (!box) return;
    const message = messages.find(item => item.id === messageId);
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const pickerWidth = Math.min(244, viewportWidth - 16);
    const pickerHeight = 132;
    const preferredTop = box.top - pickerHeight - 8;
    const fallbackTop = box.bottom + 8;
    const top = preferredTop >= viewportTop + 8 ? preferredTop : fallbackTop;
    setDeleteMenuMessageId(messageId);
    setMessageActionsPosition({
      left: Math.max(viewportLeft + 8, Math.min(message?.isMe ? box.right - pickerWidth : box.left, viewportLeft + viewportWidth - pickerWidth - 8)),
      top: Math.max(viewportTop + 8, Math.min(top, viewportTop + viewportHeight - pickerHeight - 8)),
    });
  };
  const closeMessageActions = () => {
    setDeleteMenuMessageId(null);
    setMessageActionsPosition(null);
  };
  const handleSuggestionClick = (text: string) => {
    if (sendingRef.current || startersSent >= CONVERSATION_STARTER_LIMIT) return;
    if (inputRef.current) inputRef.current.value = text;
    setHasInputText(true);
    setSelectedStarter(text);
    inputRef.current?.focus();
  };
  const leave = async (next: boolean) => {
    if (roomId && !peer.isSimulated) {
      try { await apiRequest('/api/chat/leave', session.token, { roomId }); } catch { /* Server lease expires when offline. */ }
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (next) onNextMatch(); else onLeaveChat();
  };
  const endCurrentChat = async () => {
    if (roomId && !peer.isSimulated) {
      try { await apiRequest('/api/chat/leave', session.token, { roomId }); } catch { /* Server lease expires when offline. */ }
    }
    markDisconnected();
  };
  const requestLeave = () => setPendingAction('leave');
  const confirmPendingAction = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'next') void leave(true);
    else if (action === 'leave') void endCurrentChat();
  };
  const handleAmbientChange = useCallback((next: { active: boolean; enabled: boolean; color: string; effect: 'aurora' | 'spider-web' }) => {
    setAmbient(current => current.active === next.active && current.enabled === next.enabled && current.color === next.color && current.effect === next.effect ? current : next);
  }, []);
  const ambientActive = ambient.active && ambient.enabled;
  const musicPlaying = ambient.active;
  return (
    <div
      className={`relative w-full flex-1 min-h-0 h-full flex flex-col overflow-x-hidden overflow-y-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 h-screen h-[100dvh] w-screen w-full' : ''
      } chat-theme-scope ${ambientActive ? 'ambient-playing' : ''} ${musicPlaying ? 'music-playing' : ''} ${isDarkMode ? 'text-stone-100' : 'text-stone-800'}`}
      style={{
        backgroundColor: isDarkMode ? chatTheme.darkBackground : chatTheme.lightBackground,
        '--chat-accent': chatTheme.accent,
        '--chat-accent-hover': chatTheme.accentHover,
      } as React.CSSProperties}
    >
      {ambientActive && (ambient.effect === 'spider-web'
        ? <SpiderWebBackground isDarkMode={isDarkMode} />
        : <AmbientAurora color={ambient.color} />)}
      <div className="chat-content relative w-full flex flex-col flex-1 min-h-0 h-full overflow-visible">
        <Header {...headerProps} showReroll={false}
          conversation={
          <div className="chat-header-conversation flex min-w-0 flex-1 items-center justify-center">
            <div className="chat-header-peer flex min-w-0 w-full flex-col items-center justify-center gap-0.5 text-center">
                <span title={peer.isSimulated ? STUDENT_CHATBOT_NAME : peer.handle}
                  className="chat-header-peer-name min-w-0 max-w-full line-clamp-2 break-words text-center text-[13px] font-bold leading-4 text-stone-900 dark:text-white sm:text-sm">
                  {peer.isSimulated ? STUDENT_CHATBOT_NAME : peer.handle}
                </span>
                {!peerDisconnected ? (
                  <span className="chat-theme-accent-text shrink-0 text-[10px] font-medium leading-3">
                    {peer.isSimulated ? 'AI' : 'Student'}
                  </span>
                ) : (
                  <span className="chat-theme-accent-text shrink-0 text-[10px] font-medium leading-3">Left</span>
                )}
            </div>
          </div>

          }
          displayActions={<>
            <ChatThemeMenu theme={chatTheme} onChange={onChatThemeChange} isDarkMode={isDarkMode} compact />
            {!peerDisconnected && <TopMusicBar compact isDarkMode={isDarkMode} roomId={roomId} ws={ws} token={session.token} remoteMusic={roomMusic} isSimulated={peer.isSimulated} onAmbientChange={handleAmbientChange} accent={chatTheme.accent} accentHover={chatTheme.accentHover} />}
            <button
              id="chat-fullscreen-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              className="chat-display-control flex h-8 w-8 items-center justify-center rounded-lg text-[#c8bb8d] transition-colors hover:bg-white/10 cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </>}
          chatActions={<>
            <ThemeToggle
              id="mobile-dark-mode-toggle-btn"
              isDarkMode={headerProps.isDarkMode}
              onToggle={headerProps.onToggleDarkMode}
              compact
              className="chat-theme-toggle max-[359px]:hidden min-[900px]:hidden"
            />
            {!peerDisconnected && (
              <button
                id="leave-chat-btn"
                type="button"
                onClick={requestLeave}
                aria-label="Disconnect and leave chat"
                title="Disconnect and leave chat"
                className="chat-display-control flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
              >
                <LogOut className="h-3 w-3" />
              </button>
            )}

          </>}
        />
        {/* Scrollable Messages Area */}
        <div
          id="chat-messages-container"
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 min-h-0 w-full px-3 py-5 sm:px-6 sm:py-7 overflow-y-auto overscroll-contain space-y-1 select-text"
        >
          <div className="max-w-3xl mx-auto w-full space-y-0.5">
            {messages.map((msg, index) => {
              if (msg.type === 'system') {
                const isUnsentMessage = msg.text === 'Message unsent.';
                return (
                  <div key={msg.id} className={`my-3 flex w-full ${isUnsentMessage ? (msg.isMe ? 'justify-end' : 'justify-start') : 'justify-center'}`}>
                    <div
                      className={`inline-block max-w-[92%] rounded-full border px-3 py-1.5 text-xs ${
                        isUnsentMessage ? 'text-left' : 'text-center'
                      } ${
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

              const previousMessage = messages[index - 1];
              const isGroupedWithPrevious = Boolean(
                previousMessage &&
                previousMessage.type !== 'system' &&
                previousMessage.isMe === msg.isMe &&
                previousMessage.senderHandle === msg.senderHandle &&
                msg.timestamp - previousMessage.timestamp <= 120000,
              );
              const nextMessage = messages[index + 1];
              const isGroupedWithNext = Boolean(
                nextMessage &&
                nextMessage.type !== 'system' &&
                nextMessage.isMe === msg.isMe &&
                nextMessage.senderHandle === msg.senderHandle &&
                nextMessage.timestamp - msg.timestamp <= 120000,
              );

              return (
                <div
                  key={msg.id}
                  className={`chat-message-row group flex touch-pan-y flex-col ${msg.isMe ? 'items-end' : 'items-start'} ${isGroupedWithPrevious ? 'mt-0' : ''}`}
                  onTouchStart={(event) => {
                    const touch = event.touches[0];
                    if (touch) {
                      touchRef.current = { id: msg.id, startX: touch.clientX, startY: touch.clientY, offset: 0, axis: null };
                    }
                  }}
                  onTouchMove={(event) => {
                    const touch = event.touches[0];
                    const current = touchRef.current;
                    if (!touch || !current || current.id !== msg.id) return;
                    const deltaX = touch.clientX - current.startX;
                    const deltaY = touch.clientY - current.startY;
                    if (!current.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
                      current.axis = Math.abs(deltaY) >= Math.abs(deltaX) ? 'y' : 'x';
                    }
                    if (current.axis !== 'x') return;
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
                  {!isGroupedWithPrevious && (
                    <div className="mb-2 flex max-w-[92%] items-baseline gap-1.5 px-1 text-[11px] font-mono text-stone-500 dark:text-stone-400 sm:max-w-[75%]">
                      <span className="min-w-0 truncate font-semibold text-stone-600 dark:text-stone-300">
                        {msg.isMe ? 'You' : msg.senderHandle}
                      </span>
                      <span>•</span>
                      <span className="shrink-0">
                        {messageTimeFormatter.format(msg.timestamp)}
                      </span>
                      {msg.edited && (
                        <span className="shrink-0 uppercase tracking-[0.12em] text-[9px] text-stone-500/80 dark:text-stone-400/80">
                          Edited
                        </span>
                      )}
                    </div>
                  )}

                  {/* Keep the bubble, quote, and actions within the same message column. */}
                  <div className={`relative min-w-0 w-fit ${msg.replyTo ? 'max-w-[min(92%,24rem)] sm:max-w-[min(75%,24rem)]' : 'max-w-[92%] sm:max-w-[75%]'}`}>
                    {swipe?.id === msg.id && swipe.offset !== 0 && (
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-mono font-semibold ${
                          msg.isMe ? 'right-full mr-2' : 'left-full ml-2'
                        }`}
                        style={{ color: chatTheme.accent }}
                      >
                        Reply
                      </span>
                    )}
                    <MessageReactions
                      reactions={msg.reactions}
                      sessionId={session.id}
                      onReact={emoji => handleReact(msg.id, emoji)}
                      align={msg.isMe ? 'end' : 'start'}
                      actions={(
                        <>
                          <button type="button" aria-label="Reply" title="Reply" onClick={() => setReplyingTo(msg)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
                            <Reply className="chat-theme-accent-text h-4 w-4" />
                          </button>
                          {(msg.isMe || !!msg.musicSnippet) && (
                            <button
                              type="button"
                              aria-label="More message actions"
                              title="More message actions"
                              onClick={() => {
                                if (deleteMenuMessageId === msg.id) closeMessageActions();
                                else openMessageActions(msg.id);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                            >
                              <MoreVertical className="chat-theme-accent-text h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                      onLongPress={() => openMessageActions(msg.id)}
                    >
                    <div
                      ref={element => { messageBubbleRefs.current[msg.id] = element; }}
                      data-message-bubble
                      className={`flex min-w-0 w-fit max-w-full flex-col items-stretch rounded-2xl border px-3.5 text-left text-[13px] leading-[19px] shadow-[0_1px_2px_rgba(41,37,36,0.04)] transition-transform duration-150 ${highlightedMessageId === msg.id ? 'reply-target-highlight' : ''} ${
                        isGroupedWithPrevious ? 'gap-1 py-2' : 'gap-1.5 py-2.5'
                      } ${
                        msg.isMe
                          ? 'text-white'
                          : isDarkMode
                          ? 'bg-stone-900/95 border-stone-700/80 text-stone-100'
                          : 'bg-white/95 border-stone-200 text-stone-900'
                      }`}
                      style={{
                      transform: swipe?.id === msg.id && swipe.offset !== 0 ? `translateX(${swipe.offset}px)` : undefined,
                      ...(msg.isMe ? { backgroundColor: chatTheme.accent, borderColor: chatTheme.accent } : {}),
                      }}
                    >
                      {msg.replyTo && (
                        <button
                          type="button"
                          data-reply-preview
                          aria-label={`Jump to message from ${msg.replyTo.senderHandle}`}
                          onClick={() => scrollToRepliedMessage(msg.replyTo!.id)}
                          className={`min-w-0 w-full cursor-pointer overflow-hidden rounded-md border-l-2 px-2 py-1 text-left text-[11px] leading-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${
                            msg.isMe ? 'border-white/60 bg-black/15 text-white/90' : 'border-stone-400 bg-black/5 text-stone-600 dark:border-stone-500 dark:bg-white/5 dark:text-stone-300'
                          }`}
                        >
                          <div className="truncate font-semibold">{msg.replyTo.senderHandle}</div>
                          <p className="truncate">{msg.replyTo.text}</p>
                        </button>
                      )}
                      {!!msg.images?.length && <div className={`grid min-w-0 gap-2 ${msg.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {msg.images.map(image => <button key={image.id} type="button" onClick={() => setViewingImage(image)} aria-label={'View photo ' + image.name}
                          className="block min-w-0 overflow-hidden rounded-lg bg-black/10">
                          <img src={image.url} alt={image.name} width={image.width} height={image.height}
                            className="max-h-64 w-full max-w-80 object-contain" loading="lazy" draggable={false} />
                        </button>)}
                      </div>}
                      {msg.voice && <VoiceMessagePlayer voice={msg.voice} isMe={msg.isMe} />}
                      {msg.text && <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.text}</p>}
                      {msg.musicSnippet && <MusicSnippetCard
                        snippet={msg.musicSnippet}
                        active={activeSnippetId === msg.id}
                        playing={activeSnippetId === msg.id && snippetPlaying}
                        onToggle={() => {
                          if (activeSnippetId === msg.id) setSnippetPlaying(value => !value);
                          else { setActiveSnippetId(msg.id); setSnippetPlaying(true); }
                        }}
                        onPlayingChange={setSnippetPlaying}
                      />}
                      {msg.edited && isGroupedWithPrevious && (
                        <span className={`text-[9px] uppercase tracking-[0.12em] ${msg.isMe ? 'text-white/70' : 'text-stone-500 dark:text-stone-400'}`}>
                          Edited
                        </span>
                      )}
                    </div>
                    </MessageReactions>
                  </div>
                </div>
              );
            })}

            {/* Peer Typing Indicator */}
            {isPeerTyping && (
              <div className="flex items-center space-x-2 text-xs font-mono text-stone-500 dark:text-stone-400 py-1">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 animate-pulse" style={{ backgroundColor: chatTheme.accent }} />
                  <div className="w-1.5 h-1.5 animate-pulse [animation-delay:0.2s]" style={{ backgroundColor: chatTheme.accent }} />
                  <div className="w-1.5 h-1.5 animate-pulse [animation-delay:0.4s]" style={{ backgroundColor: chatTheme.accent }} />
                </div>
                <span>{peer.isSimulated ? STUDENT_CHATBOT_NAME : peer.handle} is typing…</span>
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
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button onClick={() => void leave(true)} className="chat-theme-accent-button px-4 py-2 text-white text-xs font-bold uppercase tracking-wider cursor-pointer">Next peer</button>
                  <button type="button" onClick={() => void leave(false)} className="chat-theme-accent-soft px-4 py-2 text-xs font-bold uppercase tracking-wider cursor-pointer">Quit</button>
                </div>
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
              <ChevronDown className="chat-theme-accent-text h-4 w-4" />
              {unreadMessageCount > 0 ? `${unreadMessageCount} new message${unreadMessageCount === 1 ? '' : 's'}` : 'Latest messages'}
            </button>
          )}
        </div>

        {/* Each chat allows three successfully sent conversation starters. */}
        {!peerDisconnected && startersSent < CONVERSATION_STARTER_LIMIT && aiSuggestions.length > 0 && (
          <div id="ai-suggestions-bar" className="shrink-0 px-3 pb-2 sm:px-6 sm:pb-3">
            <div className={`mx-auto max-w-3xl rounded-2xl border px-3 py-2.5 shadow-sm ${isDarkMode ? 'border-stone-700 bg-[#1c1b1a]/95' : 'border-stone-200 bg-[#fffdfa]/95'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-1.5 shrink-0 text-stone-500 dark:text-stone-400">
                <Sparkles className="h-3.5 w-3.5" style={{ color: chatTheme.accent }} />
                <span className="brand-script text-sm font-bold" style={{ color: chatTheme.accent }}>
                  Break the ice
                </span>
                <span className="text-[10px]" aria-live="polite">{CONVERSATION_STARTER_LIMIT - startersSent} left</span>
              </div>

              {/* Shuffle button */}
              <button
                type="button"
                onClick={() => fetchAiSuggestions()}
                disabled={isSuggestionsLoading || isSending}
                title="Shuffle and generate new topic prompts"
                className="chat-theme-accent-soft flex items-center space-x-1 rounded-md px-2 py-0.5 border text-[10px] uppercase text-stone-600 dark:text-stone-300 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`chat-theme-accent-text w-3 h-3 ${isSuggestionsLoading ? 'animate-spin' : ''}`} />
                <span>Shuffle</span>
              </button>
            </div>

            {/* Suggestions list */}
            <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar pt-2 pb-0.5">
              {aiSuggestions.map((prompt, idx) => (
                <button
                  key={idx}
                  disabled={isSending}
                  onClick={() => handleSuggestionClick(prompt)}
                  title="Use this conversation starter"
                  className={`text-xs px-3 py-1.5 whitespace-nowrap rounded-full border transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
                    isDarkMode
                      ? 'bg-stone-900 border-stone-700 text-stone-300 hover:border-stone-500 hover:text-white'
                      : 'bg-white border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50'
                  }`}
                >
                  {prompt}
                </button>
              ))}
            </div>
            </div>
          </div>
        )}
            {deleteMenuMessageId && messageActionsPosition && createPortal(
              <div
                className="reaction-picker-layer fixed inset-0 z-[100]"
                onKeyDown={event => { if (event.key === 'Escape') closeMessageActions(); }}
              >
                <div className="reaction-picker-backdrop absolute inset-0 bg-black/10" onClick={closeMessageActions} />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Message actions"
                  className="reaction-picker fixed w-[244px] max-w-[calc(100vw-16px)] rounded-2xl border border-stone-700 bg-[#17191f] p-2 text-stone-100 shadow-xl"
                  style={messageActionsPosition}
                >
                  <div className="mb-1 flex items-center justify-between px-1.5 text-[11px] font-medium italic">
                    Message actions
                    <button type="button" aria-label="Close message actions" className="p-0.5 text-stone-300 hover:text-white" onClick={closeMessageActions}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const message = messages.find(item => item.id === deleteMenuMessageId);
                        closeMessageActions();
                        if (message) setReplyingTo(message);
                      }}
                      className="flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg text-[10px] text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-400"
                    >
                      <Reply className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Reply</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const message = messages.find(item => item.id === deleteMenuMessageId);
                        if (message) void navigator.clipboard?.writeText(message.musicSnippet
                          ? `${message.text ? `${message.text}\n` : ''}${message.musicSnippet.title} — ${message.musicSnippet.artist}\nhttps://www.youtube.com/watch?v=${message.musicSnippet.youtubeId}&t=${message.musicSnippet.startTime}s`
                          : message.text).catch(() => {});
                        closeMessageActions();
                      }}
                      className="flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg text-[10px] text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-400"
                    >
                      <Copy className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Copy</span>
                    </button>
                    {messages.find(item => item.id === deleteMenuMessageId)?.isMe && !messages.find(item => item.id === deleteMenuMessageId)?.musicSnippet && (
                      <button
                          type="button"
                          onClick={() => {
                            const message = messages.find(item => item.id === deleteMenuMessageId);
                            closeMessageActions();
                            if (message) {
                              setEditingMessageId(message.id);
                              if (inputRef.current) {
                                inputRef.current.value = message.text;
                                setHasInputText(Boolean(message.text.trim()));
                                inputRef.current.focus();
                              }
                            }
                          }}
                          className="flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg text-[10px] text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-red-400"
                        >
                          <Pencil className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Edit</span>
                        </button>
                    )}
                    {messages.find(item => item.id === deleteMenuMessageId)?.isMe && (
                        <button
                          type="button"
                          onClick={() => {
                            const message = messages.find(item => item.id === deleteMenuMessageId);
                            closeMessageActions();
                            if (message) void handleDeleteMessage(message);
                          }}
                          className="flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg text-[10px] text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Delete</span>
                        </button>
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-6 items-center gap-1 rounded-xl bg-white/[0.06] px-1 py-0.5 sm:hidden">
                    {MESSAGE_REACTIONS.map(({ emoji, label }) => {
                      const selected = messages.find(item => item.id === deleteMenuMessageId)?.reactions?.[session.id] === emoji;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          aria-label={label}
                          aria-pressed={selected}
                          onClick={() => {
                            if (deleteMenuMessageId) void handleReact(deleteMenuMessageId, emoji);
                            closeMessageActions();
                          }}
                          className={`flex h-8 w-full items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-white/10 ${selected ? 'bg-red-500/25' : ''}`}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>,
              document.fullscreenElement || document.body,
            )}

        {/* Bottom Input Console */}
        <div
          id="chat-input-console"
          className={`border-t px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-3 sm:pb-4 shrink-0 backdrop-blur-xl ${
            isDarkMode ? 'bg-[#141312]/88 border-stone-800' : 'bg-[#fffdfa]/88 border-stone-200'
          }`}
        >
          <div ref={composerRef} className="max-w-3xl mx-auto">
            {replyingTo && (
              <div className="mb-2 flex min-w-0 items-center gap-3 rounded-xl border-l-[3px] bg-stone-100 px-3 py-2 text-left text-xs dark:bg-stone-900" style={{ borderColor: chatTheme.accent }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-stone-700 dark:text-stone-200">Replying to {replyingTo.isMe ? 'yourself' : replyingTo.senderHandle}</p>
                  <p className="truncate text-stone-500 dark:text-stone-400">{replyingTo.text || 'Photo'}</p>
                </div>
                <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"><X className="chat-theme-accent-text h-4 w-4" /></button>
              </div>
            )}
            {editingMessageId && (
              <div className="mb-2 flex min-w-0 items-center gap-3 rounded-xl border-l-[3px] bg-stone-100 px-3 py-2 text-left text-xs dark:bg-stone-900" style={{ borderColor: chatTheme.accent }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-stone-700 dark:text-stone-200">Editing your message</p>
                  <p className="truncate text-stone-500 dark:text-stone-400">Your changes will be shared instantly.</p>
                </div>
                <button type="button" onClick={() => { setEditingMessageId(null); if (inputRef.current) { inputRef.current.value = ''; setHasInputText(false); } }} aria-label="Cancel edit" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"><X className="chat-theme-accent-text h-4 w-4" /></button>
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
            {pendingVoice && <div className="mb-2 flex items-center gap-3 rounded-xl border border-stone-200 bg-white/80 px-3 py-2 text-xs dark:border-stone-700 dark:bg-stone-900/80" aria-label="Voice message ready to send">
              <span className="font-semibold">Voice message · {formatVoiceDuration(pendingVoice.duration)}</span>
              <button type="button" onClick={() => setPendingVoice(null)} disabled={isSending} className="ml-auto flex h-7 w-7 items-center justify-center rounded-full hover:bg-stone-100 disabled:opacity-40 dark:hover:bg-stone-800" aria-label="Remove voice message"><X className="h-3.5 w-3.5" /></button>
            </div>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (editingMessageId) void handleEditMessage();
                else handleSendMessage();
              }}
              className={`flex items-center gap-1.5 rounded-2xl border p-2 transition-all duration-200 ease-out ${composerEngaged ? '-translate-y-1 shadow-[0_14px_36px_rgba(0,0,0,0.2)]' : 'translate-y-0 shadow-[0_6px_20px_rgba(41,37,36,0.08)]'} ${isDarkMode ? 'border-stone-700 bg-stone-900/95' : 'border-stone-200 bg-white/95'}`}
            >
              <div aria-hidden={!composerEngaged} className={`flex shrink-0 items-center gap-1.5 overflow-hidden transition-all duration-200 ease-out ${composerEngaged ? 'visible max-w-28 translate-x-0 opacity-100' : 'invisible max-w-0 -translate-x-2 opacity-0 pointer-events-none'}`}>
                <ChatAttachments images={pendingImages} onChange={setPendingImages} disabled={peerDisconnected || isSending || isRecordingVoice || !!editingMessageId || !!pendingVoice} onError={setError} onBusyChange={setPreparingImages} accent={chatTheme.accent} accentHover={chatTheme.accentHover} />
                {!editingMessageId && <VoiceRecorder disabled={peerDisconnected || isSending || preparingImages || pendingImages.length > 0} hasVoice={!!pendingVoice} onChange={setPendingVoice} onError={setError} onRecordingChange={setIsRecordingVoice} />}
                {!editingMessageId && <button type="button" aria-label="Send music snippet" title="Send music snippet" disabled={peerDisconnected || isSending} onClick={() => { setActiveSnippetId(null); setSnippetPlaying(false); setMusicPickerOpen(true); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-300 text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"><Music2 className="h-3.5 w-3.5" /></button>}
              </div>
              <input
                ref={inputRef}
                id="chat-message-input"
                type="text"
                disabled={peerDisconnected}
                maxLength={4000}
                aria-label={editingMessageId ? 'Edit chat message' : 'Chat message'}
                onChange={handleInputChange}
                onFocus={() => setComposerEngaged(true)}
                placeholder={
                  editingMessageId
                    ? 'Edit your message…'
                    : peerDisconnected
                        ? "Session ended. Click 'Next Peer' above."
                        : pendingImages.length ? 'Add a caption…' : `Message ${peer.isSimulated ? STUDENT_CHATBOT_NAME : peer.handle}... (Press Enter to send)`
                }
                className={`chat-theme-input min-w-0 flex-1 px-3 py-2.5 border-0 bg-transparent text-base sm:text-sm focus:outline-none focus:shadow-none disabled:opacity-50 transition-colors ${
                  isDarkMode
                    ? 'text-white placeholder:text-stone-500'
                    : 'text-stone-900 placeholder:text-stone-400'
                }`}
              />
              {editingMessageId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingMessageId(null);
                    if (inputRef.current) {
                      inputRef.current.value = '';
                      setHasInputText(false);
                    }
                  }}
                  className="chat-theme-outline flex h-10 w-10 shrink-0 items-center justify-center border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer"
                  aria-label="Cancel edit"
                  title="Cancel editing"
                >
                  <X className="chat-theme-accent-text h-4 w-4" />
                </button>
              )}
              <div className={`shrink-0 overflow-hidden transition-all duration-200 ease-out ${editingMessageId || composerEngaged ? 'visible max-w-8 translate-x-0 opacity-100' : 'invisible max-w-0 translate-x-2 opacity-0 pointer-events-none'}`}>
              <button
                id="send-message-btn"
                type="submit"
                aria-label={editingMessageId ? 'Save edited message' : isSending ? 'Sending message' : 'Send message'}
                disabled={peerDisconnected || isSending || preparingImages || isRecordingVoice || (!hasInputText && !pendingImages.length && !pendingVoice) || (editingMessageId && !inputRef.current?.value.trim())}
                className="chat-theme-accent-button flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {editingMessageId ? <Pencil className="h-3.5 w-3.5" /> : isSending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      {viewingImage && <PhotoDialog title="Photo" onClose={() => setViewingImage(null)}>
        <ZoomablePhoto src={viewingImage.url} alt={viewingImage.name} />
      </PhotoDialog>}
      {musicPickerOpen && <MusicSnippetPicker token={session.token} onClose={() => setMusicPickerOpen(false)} onSend={handleSendMusicSnippet} />}
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
            {pendingAction === 'next' ? 'Find another peer?' : 'End this chat?'}
            </h2>
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            {pendingAction === 'next'
              ? 'This conversation will end before searching for a new match.'
              : 'This conversation and its messages will be cleared. You can then choose another peer or quit.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setPendingAction(null)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs dark:border-stone-700">
              Cancel
            </button>
            <button type="button" onClick={confirmPendingAction} className="chat-theme-accent-button rounded-lg px-3 py-2 text-xs font-semibold text-white">
              {pendingAction === 'next' ? 'Find next peer' : 'End chat'}
            </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
