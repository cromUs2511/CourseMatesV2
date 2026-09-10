import type { ChatMessage } from '../types';

// Polling often returns the same history. Preserve objects and the array in that
// case so backreading does not rerender every message every 1.5 seconds.
export function reconcileMessageSnapshot(
  previous: ChatMessage[],
  incoming: Array<ChatMessage & { senderId?: string }>,
  sessionId: string,
): ChatMessage[] {
  // A transient empty poll must not wipe an active conversation. The server
  // reports room inactivity separately, and a deleted message remains a notice.
  if (incoming.length === 0 && previous.length > 0) return previous;
  const byId = new Map(previous.map(message => [message.id, message]));
  const incomingIds = new Set(incoming.map(message => message.id));
  const localSystem = previous.filter(message => message.type === 'system' && !incomingIds.has(message.id));
  const next = [...localSystem, ...incoming.map(message => {
    const normalized = { ...message, isMe: message.senderId === sessionId };
    const existing = byId.get(message.id);
    return existing && JSON.stringify(existing) === JSON.stringify(normalized) ? existing : normalized;
  })].slice(-501);
  return next.length === previous.length && next.every((message, index) => message === previous[index]) ? previous : next;
}
