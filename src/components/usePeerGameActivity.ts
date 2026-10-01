import { useEffect, useRef } from 'react';
import type { PeerGameActivity, PeerGameKey } from '../data/peerGames';

/**
 * Reports a compact live status to the chat shell so it can render one
 * generic active-game indicator. Reports only on change to avoid render loops.
 * `live` is null when there is no invitation and no unfinished game.
 */
export function usePeerGameActivity(
  onActivity: ((activity: PeerGameActivity | null) => void) | undefined,
  game: PeerGameKey,
  label: string,
  live: { status: string; incoming: boolean } | null,
) {
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const key = live ? `${game}|${live.status}|${live.incoming}` : null;
    if (lastKey.current !== key) {
      lastKey.current = key;
      onActivity?.(live ? { game, label, status: live.status, incoming: live.incoming } : null);
    }
  }, [onActivity, game, label, live]);
}
