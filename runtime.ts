import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { normalizeSharedTrack } from './src/data/musicDirectory';
import type { PeerPresence, RoomMusicState, StudentSession } from './src/types';
import { MESSAGE_REACTIONS } from './src/data/reactions';
import {
  CHAT_MEDIA_LOCK_MS,
  chatMediaRemainingSeconds,
  formatChatMediaCountdown,
} from './src/data/chatMedia';
import { MAX_ROOM_IMAGE_BYTES, parseImages, type StoredImage } from './chatImages';
import type { ChatImage } from './src/data/chatImages';
import { parseVoice, type StoredVoice } from './voiceMessages';
import type { ChatVoice } from './src/data/chatVoice';
import { normalizeMusicSnippet, type MusicSnippet } from './src/data/musicSnippet';
import { createPythonOrchestratorClient, pythonOrchestratorConfig } from './pythonOrchestrator';
import { WindowLimiter, constantTimeEqual, metrics } from './serverSecurity';
import { moderateText, normalizeIpAddress, type SafetyStore } from './safety';
import {
  createUnoChallenge,
  joinArena,
  leaveArena,
  respondToChallenge,
  unoCleanup,
  unoDropSession,
  unoGameForSession,
  unoLeaveGame,
  unoLeaveRoom,
  unoReset,
  unoStateFor,
  unoStats,
  startBotGame,
} from './uno';
import type { UnoGame } from './uno';
import { PeerTicTacToe } from './ticTacToe';
import { PeerRockPaperScissors } from './rps';
import { PeerConnectFour } from './connectFour';
import { PeerChess } from './chess';
import { PeerTrivia } from './trivia';
import { PeerWouldYouRather } from './wouldYouRather';

type Identity = StudentSession & {
  token: string;
  email: string;
  actor: string;
  ipAddress?: string;
  expiresAt: number;
};
type Participant = {
  id: string;
  handle: string;
  avatar: string;
  campus?: string;
  discipline?: string;
  interests: string[];
  allowNormal: boolean;
  ws?: WebSocket;
  lastSeen: number;
};
type Message = {
  id: string;
  senderId: string;
  senderHandle: string;
  senderAvatar: string;
  text: string;
  images?: ChatImage[];
  voice?: ChatVoice;
  musicSnippet?: MusicSnippet;
  timestamp: number;
  type: 'text' | 'system';
  reactions?: Record<string, string>;
  replyTo?: { id: string; senderHandle: string; text: string };
  edited?: boolean;
};
type RoomMusic = RoomMusicState;
type Room = {
  id: string;
  mediaUnlockAt: number;
  peers: [Participant, Participant];
  topic: string;
  messages: Message[];
  images: Map<string, StoredImage[]>;
  voices: Map<string, StoredVoice>;
  mediaBytes: number;
  typing: Map<string, number>;
  revision: number;
  music?: RoomMusic;
  ticTacToe?: PeerTicTacToe;
  rockPaperScissors?: PeerRockPaperScissors;
  connectFour?: PeerConnectFour;
  chess?: PeerChess;
  trivia?: PeerTrivia;
  wouldYouRather?: PeerWouldYouRather;
};
export const sessions = new Map<string, Identity>();
const queue = new Map<string, Participant>();
const rooms = new Map<string, Room>();
const matches = new Map<string, string>();
const sockets = new Map<string, WebSocket>();
const identities = new Map<string, Identity>();
let safety: SafetyStore | undefined;
const defaultLimits = {
  sessions: 2000,
  rooms: 500,
  queued: 1000,
  sockets: 2000,
  mediaBytes: 128 * 1024 * 1024,
};
const chatMediaLockMs =
  process.env.NODE_ENV === 'test' && process.env.CHAT_MEDIA_LOCK_MS === '0'
    ? 0
    : CHAT_MEDIA_LOCK_MS;
let limits = { ...defaultLimits };
let totalMediaBytes = 0;
let draining = false;
export function runtimeStats() {
  return {
    sessions: sessions.size,
    queued: queue.size,
    rooms: rooms.size,
    sockets: sockets.size,
    mediaBytes: totalMediaBytes,
    uno: unoStats(),
    draining,
  };
}
export function publicSession(session: Identity): StudentSession {
  return {
    id: session.id,
    campus: session.campus,
    discipline: session.discipline,
    interests: session.interests,
    sessionHandle: session.sessionHandle,
    customHandle: session.customHandle,
    sessionAvatar: session.sessionAvatar,
    createdAt: session.createdAt,
  };
}
const pythonOrchestrator = createPythonOrchestratorClient(pythonOrchestratorConfig());
const adjectives = [
  'Curious',
  'Astute',
  'Quantum',
  'Keen',
  'Creative',
  'Luminous',
  'Bright',
  'Calm',
  'Clever',
  'Cobalt',
  'Daring',
  'Focused',
  'Gentle',
  'Golden',
  'Hidden',
  'Indigo',
  'Jolly',
  'Kind',
  'Merry',
  'Mighty',
  'Patient',
  'Quiet',
  'Radiant',
  'Swift',
  'Thoughtful',
  'Vivid',
  'Witty',
  'Zealous',
];
const nouns = [
  'Cardinal',
  'Coder',
  'Architect',
  'Scholar',
  'Explorer',
  'Engineer',
  'Alchemist',
  'Badger',
  'Comet',
  'Dolphin',
  'Falcon',
  'Fox',
  'Ginkgo',
  'Heron',
  'Koala',
  'Lantern',
  'Maple',
  'Meteor',
  'Orchid',
  'Otter',
  'Panda',
  'Pioneer',
  'Raven',
  'Robin',
  'Sparrow',
  'Tamaraw',
  'Tiger',
  'Voyager',
  'Willow',
  'Yak',
];
export function generateAnonymousHandle() {
  return {
    handle:
      adjectives[crypto.randomInt(adjectives.length)] +
      ' ' +
      nouns[crypto.randomInt(nouns.length)] +
      ' #' +
      crypto.randomInt(1000, 10000),
    avatar: '',
  };
}
export const isValidEmail = (email: unknown): email is string =>
  typeof email === 'string' &&
  email.length <= 254 &&
  /^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    email,
  );
export function issueSession(
  email: string,
  profile: any = {},
  _verified = false,
  actor: string = crypto.randomUUID(),
  ipAddress?: string,
): Identity {
  if (draining || sessions.size >= limits.sessions)
    throw new Error('The service is at capacity. Please try again later.');
  const normalizedIp = normalizeIpAddress(ipAddress);
  if (safety?.isBanned(actor, normalizedIp))
    throw new Error('Access to this community has been restricted.');
  const { handle, avatar } = generateAnonymousHandle();
  const session: Identity = {
    id: crypto.randomUUID(),
    email,
    actor,
    ...(normalizedIp ? { ipAddress: normalizedIp } : {}),
    token: crypto.randomBytes(32).toString('hex'),
    campus: ['Main Campus', 'City Campus', 'North Campus', 'Digital / Online'].includes(
      profile.campus,
    )
      ? profile.campus
      : 'Main Campus',
    discipline:
      typeof profile.discipline === 'string'
        ? profile.discipline.slice(0, 100)
        : 'Computer Science & IT',
    interests: cleanInterests(profile.interests),
    sessionHandle: handle,
    customHandle: false,
    sessionAvatar: avatar,
    createdAt: Date.now(),
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  };
  sessions.set(session.token, session);
  identities.set(session.id, session);
  return session;
}
function cleanInterests(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim().slice(0, 100))
            .filter(Boolean),
        ),
      ].slice(0, 16)
    : ['General Peer Discovery'];
}
const GENERIC_INTEREST = 'general peer discovery';
// A peer silent for this long is away from the site; the 30s room cleanup still
// decides when the chat itself is abandoned and reported as offline.
const PEER_INACTIVE_MS = 20000;
const INTEREST_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'i',
  'in',
  'into',
  'like',
  'love',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);
const INTEREST_WORD_REGEX = /[\p{L}\p{N}]+/gu;
function interestWords(interests: string[]): Set<string> {
  return new Set(
    interests
      .filter((interest) => interest.toLocaleLowerCase() !== GENERIC_INTEREST)
      .flatMap((interest) => interest.toLocaleLowerCase().match(INTEREST_WORD_REGEX) || [])
      .filter((word) => word.length > 1 && !INTEREST_STOP_WORDS.has(word)),
  );
}
function sharedInterest(a: Participant, b: Participant): { score: number; topic?: string } {
  const aWords = interestWords(a.interests);
  const bWords = interestWords(b.interests);
  const sharedWords = [...aWords].filter((word) => bWords.has(word));
  if (!sharedWords.length) return { score: 0 };

  const bExactSet = new Set(b.interests.map((interest) => interest.trim().toLocaleLowerCase()));
  const exact = a.interests.find(
    (interest) =>
      interest.toLocaleLowerCase() !== GENERIC_INTEREST &&
      bExactSet.has(interest.trim().toLocaleLowerCase()),
  );
  const firstWord = sharedWords[0];
  if (!firstWord) return { score: 0 };
  const topic = exact || firstWord.replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase());
  return { score: sharedWords.length + (exact ? 100 : 0), topic };
}

function sharedInterestQuick(a: Participant, b: Participant): { score: number } {
  const aWords = interestWords(a.interests);
  const bWords = interestWords(b.interests);
  const sharedCount = [...aWords].filter((word) => bWords.has(word)).length;
  return { score: sharedCount };
}
function validSession(token: unknown) {
  const session = typeof token === 'string' ? sessions.get(token) : undefined;
  if (
    !session ||
    session.expiresAt <= Date.now() ||
    safety?.isBanned(session.actor, session.ipAddress)
  )
    return undefined;
  return session;
}
export function cookie(req: Pick<Request, 'headers'>, name: string) {
  const part = req.headers.cookie
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(name + '='));
  return part?.slice(name.length + 1);
}
export function authenticate(req: Request): Identity | undefined {
  return validSession(cookie(req, 'cm_session'));
}
function publicPeer(peer: Participant) {
  return {
    sessionId: peer.id,
    handle: peer.handle,
    avatar: peer.avatar,
    campus: peer.campus,
    discipline: peer.discipline,
    interests: peer.interests,
  };
}
function notify(ws: WebSocket | undefined, data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.close(1013, 'Slow connection; reconnect using HTTP');
      return;
    }
    ws.send(JSON.stringify(data), () => {});
  }
}
function pushUno(sessionId: string) {
  notify(sockets.get(sessionId), { type: 'uno_state', ...unoStateFor(sessionId) });
}
function pushUnoGame(game: UnoGame) {
  for (const player of game.players) pushUno(player.id);
}
function matchResult(id: string) {
  const room = rooms.get(matches.get(id) || '');
  if (!room) return null;
  const peer = room.peers.find((p) => p.id !== id)!;
  return {
    status: 'matched',
    roomId: room.id,
    peer: publicPeer(peer),
    topic: room.topic,
    mediaUnlockAt: room.mediaUnlockAt,
  };
}
function leave(id: string) {
  queue.delete(id);
  const roomId = matches.get(id);
  const room = rooms.get(roomId || '');
  for (const game of unoLeaveRoom(id, roomId)) pushUnoGame(game);
  if (!room) {
    matches.delete(id);
    return;
  }
  for (const peer of room.peers) {
    matches.delete(peer.id);
    notify(peer.ws, { type: 'peer_disconnected', roomId: room.id });
  }
  room.messages.length = 0;
  room.images.clear();
  room.voices.clear();
  totalMediaBytes -= room.mediaBytes;
  room.mediaBytes = 0;
  rooms.delete(room.id);
}
function join(session: Identity, data: any, ws?: WebSocket) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    (data.interests !== undefined &&
      (!Array.isArray(data.interests) ||
        data.interests.length > 16 ||
        data.interests.some(
          (value: unknown) => typeof value !== 'string' || value.length > 100,
        ))) ||
    (data.allowNormal !== undefined && typeof data.allowNormal !== 'boolean')
  )
    throw new Error('Invalid matching preferences.');
  if (draining) throw new Error('The service is restarting. Please reconnect shortly.');
  const existing = matchResult(session.id);
  if (existing) return existing;
  const participant: Participant = {
    id: session.id,
    handle: session.sessionHandle,
    avatar: session.sessionAvatar,
    campus: session.campus,
    discipline: session.discipline,
    interests: cleanInterests(data.interests),
    allowNormal:
      data.allowNormal === true ||
      cleanInterests(data.interests).every(
        (interest) => interest.toLocaleLowerCase() === GENERIC_INTEREST,
      ),
    ws,
    lastSeen: Date.now(),
  };
  // A repeated join updates one queue entry; it cannot match with itself.
  queue.delete(session.id);
  const now = Date.now();
  const candidates = [...queue.values()].filter((p) => {
    const queuedSession = identities.get(p.id);
    const activeSocket = !p.ws || p.ws.readyState === WebSocket.OPEN;
    if (
      !queuedSession ||
      queuedSession.expiresAt <= now ||
      safety?.isBanned(queuedSession.actor) ||
      now - p.lastSeen >= 30000 ||
      !activeSocket
    ) {
      queue.delete(p.id);
      return false;
    }
    return (
      !safety?.isBlocked(session.actor, queuedSession.actor) &&
      session.actor !== queuedSession.actor
    );
  });
  const sameVerification = candidates;
  void pythonOrchestrator.observeMatch({
    candidate: {
      id: participant.id,
      verified: false,
      interests: participant.interests,
      allowNormal: participant.allowNormal,
    },
    queued: sameVerification.map((peer) => ({
      id: peer.id,
      verified: false,
      interests: peer.interests,
      allowNormal: peer.allowNormal,
    })),
  });
  const rankedInterestMatches = sameVerification
    .map((peer) => {
      const quickScore = sharedInterestQuick(participant, peer);
      return { peer, match: quickScore };
    })
    .filter((candidate) => candidate.match.score > 0)
    .sort((a, b) => b.match.score - a.match.score);
  const topCandidate = rankedInterestMatches[0];
  const interestMatch = topCandidate
    ? { peer: topCandidate.peer, match: sharedInterest(participant, topCandidate.peer) }
    : { peer: undefined, match: { score: 0 } };
  const peer =
    interestMatch?.peer ||
    (participant.allowNormal
      ? sameVerification.find((candidate) => candidate.allowNormal)
      : undefined);
  if (!peer) {
    if (queue.size >= limits.queued)
      throw new Error('The matching queue is full. Please try again shortly.');
    queue.set(session.id, participant);
    return {
      status: 'queued',
      position: queue.size,
      interestMatchUnavailable:
        interestWords(participant.interests).size > 0 && !participant.allowNormal,
    };
  }
  if (rooms.size >= limits.rooms)
    throw new Error('The service is at capacity. Please try again later.');
  queue.delete(peer.id);
  const room: Room = {
    id: crypto.randomUUID(),
    mediaUnlockAt: Date.now() + chatMediaLockMs,
    peers: [peer, participant],
    topic: interestMatch?.match.topic || 'General Peer Discovery',
    messages: [],
    images: new Map(),
    voices: new Map(),
    mediaBytes: 0,
    typing: new Map(),
    revision: 0,
  };
  rooms.set(room.id, room);
  for (const p of room.peers) matches.set(p.id, room.id);
  for (const p of room.peers) notify(p.ws, { type: 'matched', ...matchResult(p.id) });
  return matchResult(session.id)!;
}
function requireRoom(session: Identity, id: unknown) {
  const room = typeof id === 'string' ? rooms.get(id) : undefined;
  if (!room || !room.peers.some((p) => p.id === session.id)) return undefined;
  room.peers.find((p) => p.id === session.id)!.lastSeen = Date.now();
  return room;
}

type PeerGameSnapshot = {
  snapshot(now?: number): { invitation: { id: string } | null; game: { result: unknown } | null };
};

/**
 * Only one peer game may be live per room at a time. Returns the label of a
 * different game that is currently inviting or in play, or null when free.
 * Completed games (result set) do not block new games.
 */
function activePeerGame(room: Room, except?: string): string | null {
  const entries: [string, string, PeerGameSnapshot | undefined][] = [
    ['tictactoe', 'Tic Tac Toe', room.ticTacToe],
    ['rps', 'Rock Paper Scissors', room.rockPaperScissors],
    ['connectfour', 'Connect Four', room.connectFour],
    ['chess', 'Chess', room.chess],
    ['trivia', 'Trivia', room.trivia],
    ['wyr', 'Would You Rather', room.wouldYouRather],
  ];
  for (const [key, label, instance] of entries) {
    if (!instance || key === except) continue;
    const state = instance.snapshot();
    if (state.invitation) return label;
    if (state.game && state.game.result == null) return label;
  }
  return null;
}

function assertNoOtherActiveGame(room: Room, key: string): void {
  const other = activePeerGame(room, key);
  if (other) throw new Error(`Finish your current ${other} game first.`);
}

/** An in-chat UNO table or pending UNO challenge for this room also holds the game slot. */
function roomUnoBusy(room: Room): boolean {
  for (const p of room.peers) {
    const s = unoStateFor(p.id);
    if (s.game && s.game.source === 'room' && s.game.roomId === room.id) return true;
    if (s.challenge && s.challenge.roomId === room.id) return true;
  }
  return false;
}

function assertRoomGameFree(room: Room, key: string): void {
  assertNoOtherActiveGame(room, key);
  if (roomUnoBusy(room)) throw new Error('Finish your current UNO game first.');
}
function send(session: Identity, room: Room, data: any) {
  if (typeof data.text !== 'string' || data.text.length > 4000)
    throw new Error('Messages must contain at most 4000 characters.');
  if (!moderateText(data.text).allowed)
    throw new Error('This message violates the community rules.');
  const id =
    typeof data.clientMessageId === 'string' && data.clientMessageId.length <= 100
      ? session.id + ':' + data.clientMessageId
      : crypto.randomUUID();
  const duplicate = room.messages.find((m) => m.id === id && m.senderId === session.id);
  if (duplicate) return duplicate;
  const images = parseImages(data.images);
  const voice = parseVoice(data.voice);
  const mediaRemaining = chatMediaRemainingSeconds(room.mediaUnlockAt);
  if ((images.length || voice) && mediaRemaining > 0)
    throw new Error(
      `Photos and voice messages are available in ${formatChatMediaCountdown(mediaRemaining)}.`,
    );
  const musicSnippet =
    data.musicSnippet === undefined ? undefined : normalizeMusicSnippet(data.musicSnippet);
  if (data.musicSnippet !== undefined && !musicSnippet)
    throw new Error('Choose a valid 15–30 second music snippet.');
  if (
    musicSnippet &&
    !moderateText([musicSnippet.caption, musicSnippet.title, musicSnippet.artist].join(' ')).allowed
  )
    throw new Error('This music snippet violates the community rules.');
  if (musicSnippet && (images.length || voice))
    throw new Error('Send a music snippet separately from other attachments.');
  if (!data.text.trim() && !images.length && !voice && !musicSnippet)
    throw new Error('Write a message or attach media.');
  const imageBytes = images.reduce((total, image) => total + image.bytes.length, 0);
  const addedMediaBytes = imageBytes + (voice?.bytes.length || 0);
  if (room.mediaBytes + addedMediaBytes > MAX_ROOM_IMAGE_BYTES)
    throw new Error(
      'This chat has reached its media limit. Delete earlier attachments before sending more.',
    );
  if (totalMediaBytes + addedMediaBytes > limits.mediaBytes)
    throw new Error('Media storage is temporarily full. Try again later.');
  let replyTo: Message['replyTo'];
  if (data.replyTo !== undefined) {
    if (!data.replyTo || typeof data.replyTo.id !== 'string')
      throw new Error('Reply source not found.');
    const source = room.messages.find((candidate) => candidate.id === data.replyTo.id);
    if (!source) throw new Error('Reply source not found.');
    replyTo = {
      id: source.id,
      senderHandle: source.senderHandle,
      text:
        source.type === 'system'
          ? 'Message unsent.'
          : source.text ||
            (source.musicSnippet
              ? `♫ ${source.musicSnippet.title} — ${source.musicSnippet.artist}`
              : ''),
    };
  }
  const message: Message = {
    id,
    senderId: session.id,
    senderHandle: session.sessionHandle,
    senderAvatar: session.sessionAvatar,
    text: musicSnippet ? musicSnippet.caption : data.text.trim(),
    timestamp: Date.now(),
    type: 'text',
    ...(musicSnippet ? { musicSnippet } : {}),
    ...(images.length
      ? {
          images: images.map(({ id: imageId, name, width, height }) => ({
            id: imageId,
            name,
            width,
            height,
            url: '/api/chat/images/' + [room.id, id, imageId].map(encodeURIComponent).join('/'),
          })),
        }
      : {}),
    ...(voice
      ? {
          voice: {
            id: voice.id,
            duration: voice.duration,
            mimeType: voice.mimeType,
            url: '/api/chat/voice/' + [room.id, id, voice.id].map(encodeURIComponent).join('/'),
          },
        }
      : {}),
    replyTo,
  };
  room.messages.push(message);
  room.revision += 1;
  if (images.length) room.images.set(id, images);
  if (voice) room.voices.set(id, voice);
  room.mediaBytes += addedMediaBytes;
  totalMediaBytes += addedMediaBytes;
  if (room.messages.length > 500) clearMessageMedia(room, room.messages.shift()!.id);
  room.typing.delete(session.id);
  for (const peer of room.peers)
    notify(peer.ws, { type: 'new_message', roomId: room.id, revision: room.revision, message });
  return message;
}
function clearMessageMedia(room: Room, messageId: string) {
  const previous = room.mediaBytes;
  for (const image of room.images.get(messageId) || []) room.mediaBytes -= image.bytes.length;
  const voice = room.voices.get(messageId);
  if (voice) room.mediaBytes -= voice.bytes.length;
  room.images.delete(messageId);
  room.voices.delete(messageId);
  totalMediaBytes -= previous - room.mediaBytes;
}
function removeMessage(session: Identity, room: Room, messageId: unknown) {
  if (typeof messageId !== 'string') throw new Error('Invalid message.');
  const index = room.messages.findIndex((message) => message.id === messageId);
  const message = index < 0 ? undefined : room.messages[index];
  if (!message) throw new Error('Message not found.');
  if (message.senderId !== session.id) throw new Error('You can only delete your own messages.');
  clearMessageMedia(room, messageId);
  message.images = undefined;
  message.voice = undefined;
  message.musicSnippet = undefined;
  message.reactions = undefined;
  message.replyTo = undefined;
  message.type = 'system';
  message.text = 'Message unsent.';
  for (const reply of room.messages) {
    if (reply.replyTo?.id === messageId) reply.replyTo.text = 'Message unsent.';
  }
  room.revision += 1;
  for (const peer of room.peers)
    notify(peer.ws, {
      type: 'message_unsent',
      roomId: room.id,
      revision: room.revision,
      messageId,
    });
  return message;
}
function editMessage(session: Identity, room: Room, data: any) {
  const messageId = typeof data.messageId === 'string' ? data.messageId : '';
  if (!messageId) throw new Error('Invalid message.');
  if (typeof data.text !== 'string' || data.text.length > 4000)
    throw new Error('Messages must contain at most 4000 characters.');
  const message = room.messages.find((item) => item.id === messageId);
  if (!message) throw new Error('Message not found.');
  if (message.senderId !== session.id) throw new Error('You can only edit your own messages.');
  if (message.type !== 'text') throw new Error('Only text messages can be edited.');
  if (message.musicSnippet) throw new Error('Music snippets cannot be edited.');
  const nextText = data.text.trim();
  if (!moderateText(nextText).allowed)
    throw new Error('This message violates the community rules.');
  if (!nextText) throw new Error('Write a message before saving your edit.');
  message.text = nextText;
  message.edited = true;
  room.revision += 1;
  for (const peer of room.peers)
    notify(peer.ws, { type: 'message_edited', roomId: room.id, revision: room.revision, message });
  return message;
}
function updateMusic(session: Identity, room: Room, data: any) {
  const trackId = typeof data.trackId === 'string' ? data.trackId.slice(0, 100) : '';
  if (!trackId) throw new Error('Invalid music track.');
  const volume = Number.isFinite(data.volume)
    ? Math.max(0, Math.min(100, Number(data.volume)))
    : 70;
  const track = normalizeSharedTrack(data.track);
  if (data.track !== undefined && (!track || track.id !== trackId))
    throw new Error('Invalid music track.');
  const currentMusic = room.music;
  if (
    data.position !== undefined &&
    (!Number.isFinite(data.position) || data.position < 0 || data.position > 604800)
  )
    throw new Error('Invalid playback position.');
  const now = Date.now();
  const position =
    data.position ??
    (currentMusic && currentMusic.trackId === trackId
      ? (currentMusic.position ?? 0) +
        (currentMusic.isPlaying ? Math.max(0, now - (currentMusic.updatedAt ?? now)) / 1000 : 0)
      : 0);
  const sharedTrack =
    track || (currentMusic && currentMusic.trackId === trackId ? currentMusic.track : undefined);
  room.music = {
    revision: (room.music?.revision || 0) + 1,
    trackId,
    ...(sharedTrack ? { track: sharedTrack } : {}),
    isPlaying: data.isPlaying === true,
    volume,
    isMuted: data.isMuted === true,
    ...(process.env.CHAT_MULTIPLAYER_V2 !== 'false'
      ? { position, updatedAt: now, serverNow: now }
      : {}),
  };
  for (const peer of room.peers)
    if (peer.id !== session.id)
      notify(peer.ws, { type: 'music_state', roomId: room.id, music: room.music });
}
export function attachRuntime(
  app: Express,
  server: Server,
  options: {
    safety?: SafetyStore;
    limits?: Partial<typeof defaultLimits>;
    origin?: string;
    adminUsername?: string;
    adminPassword?: string;
    adminToken?: string;
  } = {},
) {
  safety = options.safety;
  limits = { ...defaultLimits, ...options.limits };
  draining = false;
  const unoLimiter = new WindowLimiter();
  const adminLoginLimiter = new WindowLimiter();
  const adminSessions = new Map<string, number>();
  const adminCookieName = 'cm_admin';
  const adminSessionMs = 8 * 60 * 60 * 1000;
  const adminSessionKey = (token: string) =>
    crypto.createHash('sha256').update(token).digest('hex');
  const isAdminAuthenticated = (req: Request) => {
    const bearer = req.get('authorization') || '';
    if (options.adminToken && constantTimeEqual(bearer, 'Bearer ' + options.adminToken))
      return true;
    const token = cookie(req, adminCookieName);
    if (!token) return false;
    const key = adminSessionKey(token);
    const expiresAt = adminSessions.get(key);
    if (!expiresAt || expiresAt <= Date.now()) {
      adminSessions.delete(key);
      return false;
    }
    return true;
  };
  app.post('/api/admin/login', (req, res) => {
    const remoteIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!adminLoginLimiter.take(`admin-login:${remoteIp}`, 5, 15 * 60 * 1000))
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    const { username, password } = req.body ?? {};
    if (
      !options.adminUsername ||
      !options.adminPassword ||
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !constantTimeEqual(username, options.adminUsername) ||
      !constantTimeEqual(password, options.adminPassword)
    )
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    const token = crypto.randomBytes(32).toString('base64url');
    adminSessions.set(adminSessionKey(token), Date.now() + adminSessionMs);
    const secure = (options.origin || `${req.protocol}://${req.get('host')}`).startsWith('https:');
    res.setHeader(
      'Set-Cookie',
      `${adminCookieName}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${adminSessionMs / 1000}${secure ? '; Secure' : ''}`,
    );
    res.json({ authenticated: true });
  });
  app.get('/api/admin/session', (req, res) =>
    res.json({ authenticated: isAdminAuthenticated(req) }),
  );
  app.post('/api/admin/logout', (req, res) => {
    const token = cookie(req, adminCookieName);
    if (token) adminSessions.delete(adminSessionKey(token));
    const secure = (options.origin || `${req.protocol}://${req.get('host')}`).startsWith('https:');
    res.setHeader(
      'Set-Cookie',
      `${adminCookieName}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`,
    );
    res.json({ success: true });
  });
  app.use(['/api/match', '/api/chat', '/api/ai', '/api/safety', '/api/uno'], (req, res, next) => {
    if (!authenticate(req))
      return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    next();
  });
  app.get('/api/auth/session', (req, res) => {
    const session = authenticate(req);
    res.json({ session: session ? publicSession(session) : null });
  });
  app.post('/api/auth/reroll', (req, res) => {
    const session = authenticate(req);
    if (!session) return res.status(401).json({ error: 'Please sign in again.' });
    if (queue.has(session.id) || matches.has(session.id))
      return res
        .status(409)
        .json({ error: 'Leave the queue or chat before changing your handle.' });
    session.sessionHandle = generateAnonymousHandle().handle;
    session.customHandle = false;
    res.json({ session: publicSession(session) });
  });
  app.post('/api/auth/handle', (req, res) => {
    const session = authenticate(req);
    if (!session) return res.status(401).json({ error: 'Please sign in again.' });
    if (queue.has(session.id) || matches.has(session.id))
      return res.status(409).json({ error: 'Leave the queue or chat before changing your name.' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 40)
      return res.status(400).json({ error: 'Your name must be 2–40 characters.' });
    if (!moderateText(name).allowed)
      return res.status(400).json({ error: 'Choose a name that follows the community rules.' });
    session.sessionHandle = name;
    session.customHandle = true;
    res.json({ session: publicSession(session) });
  });
  app.post('/api/auth/logout', (req, res) => {
    const session = authenticate(req);
    if (session) {
      leave(session.id);
      for (const game of unoDropSession(session.id)) pushUnoGame(game);
      sockets.get(session.id)?.close();
      sessions.delete(session.token);
      identities.delete(session.id);
    }
    res.clearCookie('cm_session', { path: '/' }).json({ success: true });
  });
  app.post('/api/match/join', (req, res) => {
    const session = authenticate(req)!;
    try {
      res.json(join(session, req.body, sockets.get(session.id)));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.get(['/api/match/poll', '/api/match/status'], (req, res) => {
    const session = authenticate(req)!;
    const queued = queue.get(session.id);
    if (queued) queued.lastSeen = Date.now();
    res.json(
      matchResult(session.id) || {
        status: queued ? 'queued' : 'idle',
        position: queued ? [...queue.keys()].indexOf(session.id) + 1 : 0,
        interestMatchUnavailable:
          !!queued && interestWords(queued.interests).size > 0 && !queued.allowNormal,
      },
    );
  });
  app.post('/api/match/cancel', (req, res) => {
    leave(authenticate(req)!.id);
    res.json({ success: true });
  });
  app.post('/api/chat/send', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    try {
      res.json({ success: true, message: send(session, room, req.body) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.get('/api/chat/images/:roomId/:messageId/:imageId', (req, res) => {
    const room = requireRoom(authenticate(req)!, req.params.roomId);
    const image = room?.images
      .get(req.params.messageId)
      ?.find((image) => image.id === req.params.imageId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!image) return res.status(404).json({ error: 'This photo is no longer available.' });
    res.type(image.mimeType).send(image.bytes);
  });
  app.get('/api/chat/voice/:roomId/:messageId/:voiceId', (req, res) => {
    const room = requireRoom(authenticate(req)!, req.params.roomId);
    const voice = room?.voices.get(req.params.messageId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!voice || voice.id !== req.params.voiceId)
      return res.status(404).json({ error: 'This voice message is no longer available.' });
    res.type(voice.mimeType).send(voice.bytes);
  });
  app.post('/api/chat/react', (req, res) => {
    const session = authenticate(req);
    if (!session) return res.status(401).json({ error: 'Sign in again.' });
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended.' });
    const message = room.messages.find((item) => item.id === req.body.messageId);
    if (!message || message.type !== 'text')
      return res.status(404).json({ error: 'Message not found.' });
    const emoji = req.body.emoji;
    if (emoji !== null && !MESSAGE_REACTIONS.some((item) => item.emoji === emoji))
      return res.status(400).json({ error: 'Choose a supported reaction.' });
    message.reactions ??= {};
    if (emoji === null) delete message.reactions[session.id];
    else message.reactions[session.id] = emoji;
    room.revision += 1;
    for (const peer of room.peers)
      notify(peer.ws, {
        type: 'message_reactions',
        roomId: room.id,
        revision: room.revision,
        messageId: message.id,
        reactions: message.reactions,
      });
    res.json({ reactions: message.reactions });
  });
  app.post('/api/chat/delete', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    try {
      res.json({ success: true, message: removeMessage(session, room, req.body.messageId) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.post('/api/chat/edit', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    try {
      res.json({ success: true, message: editMessage(session, room, req.body) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.get('/api/chat/messages', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.query.roomId);
    if (!room)
      return res.json({ active: false, messages: [], peerDisconnected: true, isPeerTyping: false });
    const sinceRevision = Number(req.query.sinceRevision);
    const changed = !Number.isInteger(sinceRevision) || sinceRevision !== room.revision;
    const peer = room.peers.find((p) => p.id !== session.id)!;
    const peerPresence: PeerPresence =
      Date.now() - peer.lastSeen >= PEER_INACTIVE_MS ? 'inactive' : 'active';
    // Avoid retransmitting the bounded buffer when no chat state changed.
    res.json({
      active: true,
      messages: changed ? room.messages : [],
      revision: room.revision,
      music: room.music ? { ...room.music, serverNow: Date.now() } : undefined,
      peerDisconnected: false,
      peerPresence,
      isPeerTyping: [...room.typing].some(
        ([id, timestamp]) => id !== session.id && Date.now() - timestamp < 3000,
      ),
    });
  });
  app.post('/api/chat/music', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    try {
      updateMusic(session, room, req.body);
      res.json({ music: { ...room.music, serverNow: Date.now() } });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.get('/api/chat/tictactoe', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const room = requireRoom(authenticate(req)!, req.query.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    room.ticTacToe ??= new PeerTicTacToe();
    res.json(room.ticTacToe.snapshot());
  });
  app.post('/api/chat/tictactoe', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    if (!unoLimiter.take('ttt:' + session.id, 120, 60000))
      return res.status(429).json({ error: 'Too many game actions. Try again shortly.' });
    try {
      room.ticTacToe ??= new PeerTicTacToe();
      if (
        req.body?.action === 'invite' ||
        (req.body?.action === 'respond' && req.body?.accept === true)
      )
        assertRoomGameFree(room, 'tictactoe');
      room.ticTacToe.act(
        session.id,
        room.peers.map(({ id, handle }) => ({ id, handle })),
        req.body,
      );
      const state = room.ticTacToe.snapshot();
      for (const peer of room.peers)
        notify(peer.ws, { type: 'tictactoe_state', roomId: room.id, state });
      res.json(state);
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  // Rock Paper Scissors
  app.get('/api/chat/rps', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.query.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    room.rockPaperScissors ??= new PeerRockPaperScissors();
    res.json(room.rockPaperScissors.serializeFor(session.id));
  });
  app.post('/api/chat/rps', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    if (!unoLimiter.take('rps:' + session.id, 120, 60000))
      return res.status(429).json({ error: 'Too many game actions. Try again shortly.' });
    try {
      room.rockPaperScissors ??= new PeerRockPaperScissors();
      if (
        req.body?.action === 'invite' ||
        (req.body?.action === 'respond' && req.body?.accept === true)
      )
        assertRoomGameFree(room, 'rps');
      room.rockPaperScissors.act(
        session.id,
        room.peers.map(({ id, handle }) => ({ id, handle })),
        req.body,
      );
      for (const peer of room.peers)
        notify(peer.ws, {
          type: 'rps_state',
          roomId: room.id,
          state: room.rockPaperScissors.serializeFor(peer.id),
        });
      res.json(room.rockPaperScissors.serializeFor(session.id));
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  // Connect Four
  app.get('/api/chat/connectfour', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const room = requireRoom(authenticate(req)!, req.query.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    room.connectFour ??= new PeerConnectFour();
    res.json(room.connectFour.snapshot());
  });
  app.post('/api/chat/connectfour', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    if (!unoLimiter.take('cf:' + session.id, 120, 60000))
      return res.status(429).json({ error: 'Too many game actions. Try again shortly.' });
    try {
      room.connectFour ??= new PeerConnectFour();
      if (
        req.body?.action === 'invite' ||
        (req.body?.action === 'respond' && req.body?.accept === true)
      )
        assertRoomGameFree(room, 'connectfour');
      room.connectFour.act(
        session.id,
        room.peers.map(({ id, handle }) => ({ id, handle })),
        req.body,
      );
      const state = room.connectFour.snapshot();
      for (const peer of room.peers)
        notify(peer.ws, { type: 'connectfour_state', roomId: room.id, state });
      res.json(state);
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  // Chess
  app.get('/api/chat/chess', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const room = requireRoom(authenticate(req)!, req.query.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    room.chess ??= new PeerChess();
    res.json(room.chess.snapshot());
  });
  app.post('/api/chat/chess', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    if (!unoLimiter.take('chess:' + session.id, 120, 60000))
      return res.status(429).json({ error: 'Too many game actions. Try again shortly.' });
    try {
      room.chess ??= new PeerChess();
      if (
        req.body?.action === 'invite' ||
        (req.body?.action === 'respond' && req.body?.accept === true)
      )
        assertRoomGameFree(room, 'chess');
      room.chess.act(
        session.id,
        room.peers.map(({ id, handle }) => ({ id, handle })),
        req.body,
      );
      const state = room.chess.snapshot();
      for (const peer of room.peers)
        notify(peer.ws, { type: 'chess_state', roomId: room.id, state });
      res.json(state);
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  // Trivia
  app.get('/api/chat/trivia', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.query.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    room.trivia ??= new PeerTrivia();
    res.json(room.trivia.serializeFor(session.id));
  });
  app.post('/api/chat/trivia', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    if (!unoLimiter.take('trivia:' + session.id, 120, 60000))
      return res.status(429).json({ error: 'Too many game actions. Try again shortly.' });
    try {
      room.trivia ??= new PeerTrivia();
      if (
        req.body?.action === 'invite' ||
        (req.body?.action === 'respond' && req.body?.accept === true)
      )
        assertRoomGameFree(room, 'trivia');
      room.trivia.act(
        session.id,
        room.peers.map(({ id, handle }) => ({ id, handle })),
        req.body,
      );
      for (const peer of room.peers)
        notify(peer.ws, {
          type: 'trivia_state',
          roomId: room.id,
          state: room.trivia.serializeFor(peer.id),
        });
      res.json(room.trivia.serializeFor(session.id));
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  // Would You Rather
  app.get('/api/chat/wyr', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.query.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    room.wouldYouRather ??= new PeerWouldYouRather();
    res.json(room.wouldYouRather.serializeFor(session.id));
  });
  app.post('/api/chat/wyr', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 === 'false')
      return res.status(503).json({ error: 'Peer games are temporarily unavailable.' });
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    if (!unoLimiter.take('wyr:' + session.id, 120, 60000))
      return res.status(429).json({ error: 'Too many game actions. Try again shortly.' });
    try {
      room.wouldYouRather ??= new PeerWouldYouRather();
      if (
        req.body?.action === 'invite' ||
        (req.body?.action === 'respond' && req.body?.accept === true)
      )
        assertRoomGameFree(room, 'wyr');
      room.wouldYouRather.act(
        session.id,
        room.peers.map(({ id, handle }) => ({ id, handle })),
        req.body,
      );
      for (const peer of room.peers)
        notify(peer.ws, {
          type: 'wyr_state',
          roomId: room.id,
          state: room.wouldYouRather.serializeFor(peer.id),
        });
      res.json(room.wouldYouRather.serializeFor(session.id));
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chat/typing', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended.' });
    if (req.body.isTyping === true) room.typing.set(session.id, Date.now());
    else room.typing.delete(session.id);
    for (const peer of room.peers)
      if (peer.id !== session.id)
        notify(peer.ws, {
          type: 'peer_typing',
          roomId: room.id,
          isTyping: req.body.isTyping === true,
        });
    res.json({ success: true });
  });
  app.post('/api/chat/leave', (req, res) => {
    const session = authenticate(req)!;
    if (requireRoom(session, req.body.roomId)) leave(session.id);
    res.json({ success: true });
  });

  // --- UNO tables: arena pairing (1v1 or four players) or inside a chat room ---
  app.get('/api/uno/state', (req, res) => {
    res.json(unoStateFor(authenticate(req)!.id));
  });
  app.post('/api/uno/arena', (req, res) => {
    if (process.env.CHAT_MULTIPLAYER_V2 !== 'false')
      return res.status(410).json({
        error:
          'UNO is now a two-player game inside your current chat. Invite your peer from Games.',
      });
    const session = authenticate(req)!;
    if (!unoLimiter.take('uno-arena:' + session.id, 30, 60000))
      return res.status(429).json({ error: 'You are joining too quickly. Try again shortly.' });
    try {
      const size: 2 | 4 = req.body?.size === 4 ? 4 : 2;
      const result =
        req.body?.opponents === 'bots'
          ? {
              status: 'matched' as const,
              gameId: startBotGame(session.id, session.sessionHandle, size).id,
            }
          : joinArena(session.id, session.sessionHandle, size);
      const game = result.gameId ? unoGameForSession(session.id) : undefined;
      if (game) pushUnoGame(game);
      res.json(result);
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  app.post('/api/uno/arena/cancel', (req, res) => {
    leaveArena(authenticate(req)!.id);
    res.json({ success: true });
  });
  app.post('/api/uno/challenge', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body?.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    const peer = room.peers.find((p) => p.id !== session.id);
    if (!peer) return res.status(404).json({ error: 'Your peer is no longer here.' });
    if (!unoLimiter.take('uno-challenge:' + session.id, 20, 60000))
      return res.status(429).json({ error: 'Too many challenges. Slow down.' });
    try {
      const other = activePeerGame(room);
      if (other) throw new Error(`Finish your current ${other} game first.`);
      const challenge = createUnoChallenge(
        { id: session.id, handle: session.sessionHandle },
        { id: peer.id, handle: peer.handle },
        room.id,
      );
      pushUno(challenge.toId);
      res.json({
        challenge: {
          id: challenge.id,
          direction: 'outgoing',
          fromHandle: challenge.fromHandle,
          roomId: challenge.roomId,
        },
      });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  app.post('/api/uno/challenge/respond', (req, res) => {
    const session = authenticate(req)!;
    try {
      const result = respondToChallenge(
        String(req.body?.challengeId || ''),
        session.id,
        req.body?.accept === true,
      );
      if (result.game) pushUnoGame(result.game);
      else {
        pushUno(result.challenge.fromId);
        pushUno(result.challenge.toId);
      }
      res.json({ started: !!result.game });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.post('/api/uno/action', (req, res) => {
    const session = authenticate(req)!;
    if (!unoLimiter.take('uno:' + session.id, 240, 60000))
      return res.status(429).json({ error: 'Too many moves. Take a breath.' });
    const game = unoGameForSession(session.id);
    if (!game || String(req.body?.gameId || '') !== game.id)
      return res.status(404).json({ error: 'That table is no longer available.' });
    try {
      const action = req.body?.action;
      if (req.body?.round !== undefined && req.body.round !== game.round)
        throw new Error('That round has ended.');
      if (action === 'play') game.play(session.id, String(req.body?.cardId || ''), req.body?.color);
      else if (action === 'draw') game.draw(session.id);
      else if (action === 'pass') game.pass(session.id);
      else if (action === 'uno') game.callUno(session.id);
      else if (action === 'rematch') {
        if (!game.roomId || !requireRoom(session, game.roomId))
          throw new Error('Your chat has ended.');
        if (game.players.some((player) => unoGameForSession(player.id)?.id !== game.id))
          throw new Error('Your peer left this table. Send a new invitation.');
        game.rematch(session.id, req.body?.round);
      } else throw new Error('Invalid game action.');
      pushUnoGame(game);
      res.json(unoStateFor(session.id));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.post('/api/uno/away', (req, res) => {
    const session = authenticate(req)!;
    const game = unoGameForSession(session.id);
    if (!game) return res.json({ success: true, state: unoStateFor(session.id) });
    game.markAway(session.id, req.body?.away === true);
    pushUnoGame(game);
    res.json({ success: true, state: unoStateFor(session.id) });
  });
  app.post('/api/uno/leave', (req, res) => {
    const session = authenticate(req)!;
    const game = unoLeaveGame(session.id);
    if (game) pushUnoGame(game);
    res.json({ success: true });
  });
  app.get(['/api/health', '/api/health/live'], (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/ready', (_req, res) => {
    try {
      safety?.listReports();
    } catch {
      return res.status(503).json({ status: 'unavailable' });
    }
    res.status(draining ? 503 : 200).json({ status: draining ? 'draining' : 'ready' });
  });

  for (const action of ['report', 'block'] as const)
    app.post('/api/safety/' + action, (req, res) => {
      const session = authenticate(req)!;
      const room = requireRoom(session, req.body.roomId);
      if (!room || !safety) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
      const peer = identities.get(room.peers.find((p) => p.id !== session.id)!.id)!;
      try {
        if (action === 'report') {
          const report = safety.report(
            session.actor,
            peer.actor,
            req.body.category,
            peer.ipAddress,
          );
          return res.json({ success: true, reportId: report.id });
        }
        safety.block(session.actor, peer.actor);
        leave(session.id);
        res.json({ success: true });
      } catch {
        res.status(400).json({
          error: 'This safety action could not be saved. Check the category or try again later.',
        });
      }
    });
  app.use('/api/admin', (req, res, next) => {
    if (!isAdminAuthenticated(req))
      return res.status(401).json({ error: 'Administrator authentication required.' });
    next();
  });
  app.get('/api/admin/metrics', (_req, res) =>
    res.json({ ...metrics, ...runtimeStats(), memory: process.memoryUsage().rss }),
  );
  app.get('/api/admin/reports', (_req, res) => {
    try {
      const reports = safety?.listReports() || [];
      const bans = safety?.listBans() || [];
      res.json({
        bans,
        reports: reports.map((report) => ({
          ...report,
          actorBanned: safety?.isActorBanned(report.target) ?? false,
          ipBanned: safety?.isIpBanned(report.ipAddress) ?? false,
        })),
      });
    } catch {
      res.status(503).json({ error: 'Moderation storage is unavailable.' });
    }
  });
  app.post('/api/admin/moderate', (req, res) => {
    if (!safety) return res.status(503).json({ error: 'Moderation storage is unavailable.' });
    try {
      const { action, actor, reportId } = req.body;
      if (action === 'resolve') safety.resolveReport(reportId);
      else if (action === 'unban') safety.unban(actor);
      else if (action === 'unbanIp') safety.unbanIp(req.body.ipAddress);
      else if (action === 'ban') {
        const report = safety.listReports().find((item) => item.id === reportId);
        const durationMs = req.body.durationMs;
        if (!report || report.target !== actor)
          return res
            .status(400)
            .json({ error: 'Select a valid report before restricting access.' });
        if (durationMs !== null && ![86_400_000, 172_800_000, 259_200_000].includes(durationMs))
          return res
            .status(400)
            .json({ error: 'Choose a 1, 2, or 3 day restriction, or permanent.' });
        const ipAddress = req.body.includeIp === true ? report.ipAddress : null;
        if (req.body.includeIp === true && !ipAddress)
          return res
            .status(400)
            .json({ error: 'This report has no verified IP address to restrict.' });
        safety.ban(actor, durationMs, ipAddress);
        for (const session of sessions.values())
          if (session.actor === actor || (ipAddress !== null && session.ipAddress === ipAddress)) {
            leave(session.id);
            sockets.get(session.id)?.close(1008, 'Access restricted');
            sessions.delete(session.token);
            identities.delete(session.id);
          }
      } else return res.status(400).json({ error: 'Invalid moderation action.' });
      res.json({ success: true });
    } catch {
      res.status(400).json({ error: 'Moderation action could not be saved.' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  const socketLimiter = new WindowLimiter();
  server.on('upgrade', (req, socket, head) => {
    const reject = (status: number) => {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (req.url !== '/ws/chat') {
      reject(404);
      return;
    }
    const expectedOrigin = options.origin || process.env.APP_URL || 'http://' + req.headers.host;
    if (req.headers.origin !== expectedOrigin) {
      reject(403);
      return;
    }
    const session = validSession(cookie(req, 'cm_session'));
    if (!session) {
      reject(401);
      return;
    }
    if (
      draining ||
      wss.clients.size >= limits.sockets ||
      !socketLimiter.take('upgrade:' + (req.socket.remoteAddress || ''), 120, 60000)
    ) {
      reject(503);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, session));
  });
  wss.on('connection', (ws, incomingSession) => {
    const session = incomingSession as unknown as Identity;
    let joined = false;
    const timeout = setTimeout(() => {
      if (!joined) ws.close(1008, 'Join required');
    }, 5000);
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data) ||
          typeof data.type !== 'string' ||
          data.token !== undefined
        ) {
          ws.close(1008, 'Invalid request');
          return;
        }
        if (!validSession(session.token)) {
          ws.close(1008, 'Invalid session');
          return;
        }
        if (!socketLimiter.take('message:' + session.id, 240, 60000)) {
          ws.close(1008, 'Rate limit exceeded');
          return;
        }
        if (data.type === 'join_queue') {
          joined = true;
          const previous = sockets.get(session.id);
          if (previous && previous !== ws) previous.close(1000, 'Connection replaced');
          sockets.set(session.id, ws);
          clearTimeout(timeout);
          const room = rooms.get(matches.get(session.id) || '');
          if (room) room.peers.find((p) => p.id === session!.id)!.ws = ws;
          const result = join(session, data, ws);
          if (room || result.status === 'queued') notify(ws, { type: result.status, ...result });
          if (room?.music)
            notify(ws, {
              type: 'music_state',
              roomId: room.id,
              music: { ...room.music, serverNow: Date.now() },
            });
          return;
        }
        if (!joined) {
          ws.close(1008, 'Join required');
          return;
        }
        if (data.type === 'leave_queue') {
          leave(session.id);
          return;
        }
        if (data.type === 'ping') {
          const queued = queue.get(session.id);
          if (queued) queued.lastSeen = Date.now();
          requireRoom(session, matches.get(session.id));
          notify(ws, { type: 'pong' });
          return;
        }
        const room = requireRoom(session, data.roomId);
        if (!room) return notify(ws, { type: 'error', error: 'Chat ended or is unavailable.' });
        if (data.type === 'send_message') {
          if (data.images !== undefined || data.voice !== undefined)
            throw new Error('Use HTTP for media.');
          send(session, room, data);
        } else if (data.type === 'delete_message') removeMessage(session, room, data.messageId);
        else if (data.type === 'edit_message') editMessage(session, room, data);
        else if (data.type === 'music_update') updateMusic(session, room, data);
        else if (data.type === 'leave_room') leave(session.id);
      } catch {
        notify(ws, { type: 'error', error: 'Invalid request.' });
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(timeout);
      if (session && sockets.get(session.id) === ws) {
        sockets.delete(session.id);
        // REST polling can continue the same room after a transport failure.
        const queued = queue.get(session.id);
        if (queued?.ws === ws) queued.ws = undefined;
        const room = rooms.get(matches.get(session.id) || '');
        const participant = room?.peers.find((p) => p.id === session!.id);
        if (participant?.ws === ws) participant.ws = undefined;
      }
    });
  });
  const cleanup = setInterval(() => {
    for (const [id, p] of queue) if (Date.now() - p.lastSeen > 30000) queue.delete(id);
    for (const room of rooms.values())
      if (room.peers.some((p) => Date.now() - p.lastSeen > 30000)) leave(room.peers[0].id);
    for (const game of unoCleanup()) pushUnoGame(game);
    for (const [token, session] of sessions)
      if (session.expiresAt <= Date.now()) {
        leave(session.id);
        for (const game of unoDropSession(session.id)) pushUnoGame(game);
        sockets.get(session.id)?.close();
        sessions.delete(token);
        identities.delete(session.id);
      }
  }, 5000);
  cleanup.unref();
  return () => {
    draining = true;
    clearInterval(cleanup);
    for (const ws of wss.clients) {
      notify(ws, { type: 'server_restart' });
      ws.close(1012, 'Service restarting');
    }
    const force = setTimeout(() => {
      for (const ws of wss.clients) ws.terminate();
    }, 1000);
    force.unref();
    for (const room of rooms.values()) leave(room.peers[0].id);
    queue.clear();
    sessions.clear();
    identities.clear();
    sockets.clear();
    adminSessions.clear();
    unoReset();
    wss.close();
  };
}
