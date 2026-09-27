export const CHAT_MEDIA_LOCK_MS = 90_000;

export function chatMediaRemainingSeconds(unlockAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((unlockAt - now) / 1_000));
}

export function formatChatMediaCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
