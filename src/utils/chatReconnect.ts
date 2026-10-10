import type { ActivePeerInfo } from '../types';

/** Persisted so a reloaded or backgrounded tab can rejoin the same chat. */
export interface SavedActiveChat {
  version: 1;
  sessionId: string;
  roomId: string;
  peer: ActivePeerInfo;
  topic: string;
}

const ACTIVE_CHAT_KEY = 'cm_active_chat';

function isPeer(value: unknown): value is ActivePeerInfo {
  if (!value || typeof value !== 'object') return false;
  const peer = value as Record<string, unknown>;
  return (
    typeof peer.sessionId === 'string' &&
    typeof peer.handle === 'string' &&
    typeof peer.matchedAt === 'number' &&
    typeof peer.mediaUnlockAt === 'number'
  );
}

/** Remember the live chat. Never throws: storage can be unavailable. */
export function saveActiveChat(snapshot: SavedActiveChat): void {
  try {
    localStorage.setItem(ACTIVE_CHAT_KEY, JSON.stringify({ ...snapshot, version: 1 }));
  } catch {
    /* Private browsers may refuse storage; the chat still works in memory. */
  }
}

/** Read back the live chat, or null when there is nothing valid to rejoin. */
export function loadActiveChat(): SavedActiveChat | null {
  try {
    const raw = localStorage.getItem(ACTIVE_CHAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedActiveChat>;
    if (
      parsed.version !== 1 ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.roomId !== 'string' ||
      typeof parsed.topic !== 'string' ||
      !isPeer(parsed.peer)
    )
      return null;
    return {
      version: 1,
      sessionId: parsed.sessionId,
      roomId: parsed.roomId,
      peer: parsed.peer,
      topic: parsed.topic,
    };
  } catch {
    return null;
  }
}

/** Forget the live chat, e.g. after leaving, ending, or expiring it. */
export function clearActiveChat(): void {
  try {
    localStorage.removeItem(ACTIVE_CHAT_KEY);
  } catch {
    /* Already gone or storage unavailable. */
  }
}
