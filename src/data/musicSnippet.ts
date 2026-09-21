export interface MusicSnippet {
  trackId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  youtubeId: string;
  startTime: number;
  duration: number;
  caption: string;
}

// Snippets carry YouTube IDs, never arbitrary media or image URLs from a peer.
export function normalizeMusicSnippet(value: unknown): MusicSnippet | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<MusicSnippet>;
  if (typeof input.trackId !== 'string' || !input.trackId.trim() || input.trackId.length > 100 ||
      typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 ||
      typeof input.artist !== 'string' || !input.artist.trim() || input.artist.length > 100 ||
      typeof input.youtubeId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(input.youtubeId) ||
      !Number.isInteger(input.startTime) || input.startTime < 0 || input.startTime > 86400 ||
      !Number.isInteger(input.duration) || input.duration < 15 || input.duration > 30 ||
      typeof input.caption !== 'string' || input.caption.length > 280) return null;
  return {
    trackId: input.trackId.trim(), title: input.title.trim(), artist: input.artist.trim(),
    artworkUrl: `https://img.youtube.com/vi/${input.youtubeId}/hqdefault.jpg`,
    youtubeId: input.youtubeId, startTime: input.startTime, duration: input.duration,
    caption: input.caption.trim(),
  };
}
