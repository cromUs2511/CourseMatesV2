import { useEffect, useRef, useState } from 'react';
import { getYouTubeErrorMessage, loadYouTubeAPI, type YouTubePlayer } from '../utils/youtubePlayer';

interface Props {
  youtubeId: string;
  startTime: number;
  duration: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onError: (message: string) => void;
}

export function YouTubeSnippetPlayer({ youtubeId, startTime, duration, playing, onPlayingChange, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const endedRef = useRef(false);
  const playingRef = useRef(playing);
  const callbacksRef = useRef({ onPlayingChange, onError });
  const [loading, setLoading] = useState(true);
  playingRef.current = playing;
  callbacksRef.current = { onPlayingChange, onError };

  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (!host) return;
    const mount = document.createElement('div');
    host.replaceChildren(mount);
    const clip = { videoId: youtubeId, startSeconds: startTime, endSeconds: startTime + duration };
    void loadYouTubeAPI().then(YT => {
      if (disposed) return;
      playerRef.current = new YT.Player(mount, {
        width: 220, height: 220, videoId: youtubeId,
        playerVars: { controls: 1, playsinline: 1, origin: location.origin },
        events: {
          onReady: ({ target }) => {
            if (disposed) return;
            readyRef.current = true;
            setLoading(false);
            if (playingRef.current) target.loadVideoById(clip);
            else target.cueVideoById(clip);
          },
          onStateChange: ({ data }) => {
            if (disposed) return;
            if (data === 0) endedRef.current = true;
            if (data === 0 || data === 2) callbacksRef.current.onPlayingChange(false);
            if (data === 1) callbacksRef.current.onPlayingChange(true);
          },
          onError: ({ data }) => { if (!disposed) callbacksRef.current.onError(getYouTubeErrorMessage(data)); },
          onAutoplayBlocked: () => { if (!disposed) callbacksRef.current.onError('Press play on the visible YouTube player to start this snippet.'); },
        },
      });
    }).catch(error => { if (!disposed) { setLoading(false); callbacksRef.current.onError((error as Error).message); } });
    const timer = globalThis.setInterval(() => {
      if (!disposed && readyRef.current && playingRef.current && playerRef.current &&
          playerRef.current.getCurrentTime() >= startTime + duration - 0.05) {
        endedRef.current = true;
        playerRef.current.pauseVideo();
        callbacksRef.current.onPlayingChange(false);
      }
    }, 200);
    return () => {
      disposed = true;
      globalThis.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
      host.replaceChildren();
    };
  }, [youtubeId, startTime, duration]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    if (playing) {
      if (endedRef.current) {
        endedRef.current = false;
        player.loadVideoById({ videoId: youtubeId, startSeconds: startTime, endSeconds: startTime + duration });
      } else player.playVideo();
    } else player.pauseVideo();
  }, [playing, youtubeId, startTime, duration]);

  return <div className="w-[220px] max-w-full rounded-xl border border-stone-700 bg-black p-2 text-center text-white" aria-label="Visible YouTube snippet player">
    {loading && <p className="mb-2 text-xs">Loading YouTube preview…</p>}
    <div ref={hostRef} className="mx-auto h-[220px] w-[220px] max-w-full overflow-hidden rounded-md" />
    <p className="mt-1 text-[10px] text-stone-400">Playing from YouTube</p>
  </div>;
}
