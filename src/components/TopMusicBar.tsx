import React, { useState, useEffect, useImperativeHandle, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  LoaderCircle,
  ListPlus,
  Music2,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import { MusicTrack, RoomMusicState } from '../types';
import {
  extractYouTubeVideoId,
  isSpiderManTrack,
  normalizeSharedTrack,
} from '../data/musicDirectory';
import {
  getYouTubeErrorMessage,
  isEmbedForbiddenError,
  isIOSOrSafari,
  loadYouTubeAPI,
  prepareYouTubeIframe,
  YouTubePlayer,
} from '../utils/youtubePlayer';

const EMPTY_MUSIC_TRACK: MusicTrack = {
  id: '',
  title: 'No song selected',
  artist: '',
  youtubeUrl: '',
  youtubeVideoId: '',
  category: 'custom',
};
const MAX_MUSIC_QUEUE_LENGTH = 50;

const AMBIENT_GLOW_COLORS = [
  { name: 'Aurora mint', color: '#6ee7b7' },
  { name: 'Arctic cyan', color: '#67e8f9' },
  { name: 'Sky blue', color: '#60a5fa' },
  { name: 'Violet', color: '#a78bfa' },
  { name: 'Neon pink', color: '#f472b6' },
  { name: 'Rose', color: '#fb7185' },
  { name: 'Sunset orange', color: '#fb923c' },
  { name: 'Solar yellow', color: '#facc15' },
  { name: 'Emerald', color: '#34d399' },
  { name: 'Lime', color: '#a3e635' },
  { name: 'Electric purple', color: '#c084fc' },
  { name: 'Ice white', color: '#e0f2fe' },
] as const;

interface TopMusicBarProps {
  isDarkMode: boolean;
  roomId?: string;
  ws?: WebSocket;
  isSimulated?: boolean;
  remoteMusic?: RoomMusicState;
  onAmbientChange?: (ambient: {
    active: boolean;
    enabled: boolean;
    color: string;
    effect: 'aurora' | 'spider-web';
  }) => void;
  accent?: string;
  accentHover?: string;
}

export type TopMusicBarHandle = {
  openMenu: () => void;
};

export const TopMusicBar = React.forwardRef<
  TopMusicBarHandle,
  TopMusicBarProps & { compact?: boolean }
>(function TopMusicBar(
  {
    isDarkMode,
    roomId,
    ws,
    isSimulated,
    remoteMusic,
    onAmbientChange,
    accent = '#991B1B',
    accentHover = '#7F1D1D',
    compact = false,
  },
  ref,
) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [playQueue, setPlayQueue] = useState<MusicTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState(70);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [notificationDismissed, setNotificationDismissed] = useState(false);
  const [glowEnabled, setGlowEnabled] = useState(() => {
    try {
      return localStorage.getItem('coursemates_music_glow') !== 'false';
    } catch {
      return true;
    }
  });
  const [glowColor, setGlowColor] = useState(() => {
    try {
      return localStorage.getItem('coursemates_music_glow_color') || '#6ee7b7';
    } catch {
      return '#6ee7b7';
    }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef<AbortController | null>(null);

  useImperativeHandle(ref, () => ({ openMenu: () => setIsMenuOpen(true) }), []);

  useEffect(() => () => searchRequestRef.current?.abort(), []);
  useEffect(() => {
    if (!isMenuOpen) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !dialogRef.current?.contains(target))
        setIsMenuOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [isMenuOpen]);
  const [playerError, setPlayerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [playerEnabled, setPlayerEnabled] = useState(false);
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playerReadyRef = useRef(false);
  const wantsPlaybackRef = useRef(false);
  // iOS/Safari needs a real tap before unmuted playback. Remote "play" events
  // arriving before any local gesture must cue, never auto-load with sound.
  const hasGestureRef = useRef(false);
  const markGesture = () => {
    hasGestureRef.current = true;
  };
  const lastTrackEndedRef = useRef(false);
  const playQueueRef = useRef(playQueue);
  playQueueRef.current = playQueue;
  const startTrackRef = useRef<
    (track: MusicTrack, resume?: boolean, sync?: boolean, queue?: MusicTrack[]) => void
  >(() => {});
  const loadingTrackRef = useRef(false);
  const hasSelectedTrackRef = useRef(false);
  const appliedRevision = useRef(0);
  const updateQueue = useRef(Promise.resolve());
  const [syncError, setSyncError] = useState('');
  const [needsGesture, setNeedsGesture] = useState(false);
  const clockRef = useRef<{ position: number; receivedAt: number; playing: boolean } | null>(null);
  const applyRemoteRef = useRef<(remote: RoomMusicState) => void>(() => {});
  const expectedPosition = () => {
    const clock = clockRef.current;
    return clock
      ? clock.position + (clock.playing ? (performance.now() - clock.receivedAt) / 1000 : 0)
      : 0;
  };
  const broadcast = (
    state: {
      trackId: string;
      isPlaying: boolean;
      volume: number;
      isMuted: boolean;
      position?: number;
      queue?: MusicTrack[];
      ended?: boolean;
    },
    track = tracks.find((item) => item.id === state.trackId),
  ) => {
    if (!roomId || isSimulated) return;
    setSyncError('');
    const position = state.position ?? playerRef.current?.getCurrentTime() ?? expectedPosition();
    const sentAt = performance.now();
    updateQueue.current = updateQueue.current.then(async () => {
      try {
        const payload = {
          roomId,
          ...state,
          position: Math.max(
            0,
            position + (state.isPlaying ? (performance.now() - sentAt) / 1000 : 0),
          ),
          ...(track ? { track } : {}),
        };
        let data: { music: RoomMusicState } | null = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            data = await apiRequest<{ music: RoomMusicState }>('/api/chat/music', payload);
            break;
          } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }
        if (!data)
          throw lastError instanceof Error ? lastError : new Error('Music could not sync.');
        applyRemoteRef.current(data.music);
        setSyncError('');
      } catch (error) {
        setSyncError(
          error instanceof Error
            ? error.message
            : 'Music could not sync. Press Play or Pause to try again.',
        );
      }
    });
  };

  const currentTrack = tracks[currentTrackIndex] || tracks[0] || EMPTY_MUSIC_TRACK;
  const hasCurrentTrack = Boolean(currentTrack.id);
  const latestRef = useRef({ currentTrack, isMuted, volume });
  latestRef.current = { currentTrack, isMuted, volume };

  useEffect(() => {
    const applyRemote = (remote: RoomMusicState) => {
      try {
        if (remote.revision <= appliedRevision.current) return;
        let index = tracks.findIndex((track) => track.id === remote.trackId);
        const sharedTrack = normalizeSharedTrack(remote.track);
        const track = sharedTrack?.id === remote.trackId ? sharedTrack : tracks[index];
        if (!track) return;
        const queue = Array.isArray(remote.queue)
          ? remote.queue
              .map(normalizeSharedTrack)
              .filter((queuedTrack): queuedTrack is MusicTrack => !!queuedTrack)
              .slice(0, MAX_MUSIC_QUEUE_LENGTH)
          : [];
        appliedRevision.current = remote.revision;
        const position =
          (remote.position ?? 0) +
          (remote.isPlaying
            ? Math.max(0, (remote.serverNow ?? remote.updatedAt ?? 0) - (remote.updatedAt ?? 0)) /
              1000
            : 0);
        clockRef.current =
          remote.position === undefined
            ? null
            : { position, receivedAt: performance.now(), playing: remote.isPlaying };
        playQueueRef.current = queue;
        setPlayQueue(queue);
        if (index < 0) {
          index = tracks.length;
          setTracks((previous) => [...previous, track]);
        }
        hasSelectedTrackRef.current = true;
        const trackChanged =
          latestRef.current.currentTrack.id !== track.id ||
          latestRef.current.currentTrack.youtubeVideoId !== track.youtubeVideoId;
        const shouldLoadTrack = trackChanged || (remote.isPlaying && remote.position === 0);
        latestRef.current = { currentTrack: track, volume: remote.volume, isMuted: remote.isMuted };
        setPlayerError('');
        setCurrentTrackIndex(index);
        setVolume(remote.volume);
        setIsMuted(remote.isMuted);
        setIsPlaying(remote.isPlaying);
        lastTrackEndedRef.current = remote.ended === true;
        wantsPlaybackRef.current = remote.isPlaying;
        // A remote "play" is never a user gesture on this device. On Apple
        // platforms an immediate load/play is blocked and used to surface as
        // "Music could not play" — cue and wait for the join tap instead.
        const remoteNeedsGesture = remote.isPlaying && !hasGestureRef.current && isIOSOrSafari();
        if (remoteNeedsGesture) {
          setNeedsGesture(true);
          setIsPlaying(false);
          setIsLoading(false);
        } else {
          setIsPlaying(remote.isPlaying);
          setIsLoading(remote.isPlaying);
        }
        if (playerReadyRef.current && playerRef.current) {
          playerRef.current.setVolume(remote.volume);
          if (remote.isMuted) playerRef.current.mute();
          else playerRef.current.unMute();
          if (shouldLoadTrack) {
            const video = { videoId: track.youtubeVideoId, startSeconds: position };
            if (remote.isPlaying && !remoteNeedsGesture) {
              loadingTrackRef.current = true;
              playerRef.current.loadVideoById(video);
            } else {
              loadingTrackRef.current = false;
              playerRef.current.cueVideoById(video);
            }
          } else if (!remoteNeedsGesture) {
            if (
              remote.position !== undefined &&
              Math.abs(playerRef.current.getCurrentTime() - position) > 0.75
            )
              playerRef.current.seekTo(position, true);
            if (remote.isPlaying) playerRef.current.playVideo();
            else if (remote.position === 0) playerRef.current.stopVideo();
            else playerRef.current.pauseVideo();
          }
        } else {
          setPlayerEnabled(true);
        }
      } catch {
        /* Ignore malformed room events. */
      }
    };
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'music_state' && data.roomId === roomId && data.music)
          applyRemote(data.music);
      } catch {
        /* Polling recovers missed events. */
      }
    };
    applyRemoteRef.current = applyRemote;
    if (remoteMusic) applyRemote(remoteMusic);
    ws?.addEventListener('message', onMessage);
    return () => ws?.removeEventListener('message', onMessage);
  }, [roomId, tracks, ws, remoteMusic]);

  useEffect(() => {
    const correctDrift = () => {
      const player = playerRef.current;
      if (
        !playerReadyRef.current ||
        !player ||
        !clockRef.current?.playing ||
        !wantsPlaybackRef.current ||
        loadingTrackRef.current ||
        document.hidden
      )
        return;
      const clock = clockRef.current;
      const expected = clock.position + (performance.now() - clock.receivedAt) / 1000;
      if (Math.abs(player.getCurrentTime() - expected) > 1.5) player.seekTo(expected, true);
    };
    const timer = window.setInterval(correctDrift, 4000);
    document.addEventListener('visibilitychange', correctDrift);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', correctDrift);
    };
  }, []);

  useEffect(() => {
    if (!playerEnabled) return;
    let disposed = false;
    let player: YouTubePlayer | null = null;
    playerReadyRef.current = false;
    const requestGesture = () => {
      if (disposed) return;
      loadingTrackRef.current = false;
      setIsPlaying(false);
      setIsLoading(false);
      setPlayerError('');
      setNeedsGesture(true);
    };
    const fail = (message: string) => {
      if (disposed) return;
      wantsPlaybackRef.current = false;
      setIsPlaying(false);
      setIsLoading(false);
      setPlayerError(message);
    };
    const timeout = window.setTimeout(() => {
      // On iOS/Safari a stalled load is almost always autoplay waiting for a
      // tap — offer the join prompt instead of a fatal error.
      if (wantsPlaybackRef.current && isIOSOrSafari()) requestGesture();
      else
        fail(
          'YouTube is taking too long to load. Check your connection, then press Play to retry.',
        );
    }, 20000);

    loadYouTubeAPI()
      .then((api) => {
        if (disposed || !playerHostRef.current) return;
        // YouTube replaces this child, leaving React's host element intact.
        const mount = document.createElement('div');
        playerHostRef.current.replaceChildren(mount);
        player = new api.Player(mount, {
          width: 320,
          height: 180,
          videoId: latestRef.current.currentTrack.youtubeVideoId,
          playerVars: {
            playsinline: 1,
            controls: 0,
            rel: 0,
            fs: 0,
            disablekb: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: ({ target }) => {
              if (disposed) return;
              window.clearTimeout(timeout);
              playerReadyRef.current = true;
              prepareYouTubeIframe(playerHostRef.current);
              target.setVolume(latestRef.current.volume);
              if (latestRef.current.isMuted) target.mute();
              else target.unMute();
              // Remote-initiated playback on Apple devices must cue until the
              // user taps: auto-loading with sound is blocked and surfaces as
              // "Music could not play" instead of the join prompt.
              const needsCueFirst =
                wantsPlaybackRef.current && !hasGestureRef.current && isIOSOrSafari();
              if (wantsPlaybackRef.current && !needsCueFirst) {
                loadingTrackRef.current = true;
                target.loadVideoById({
                  videoId: latestRef.current.currentTrack.youtubeVideoId,
                  startSeconds: expectedPosition(),
                });
              } else {
                if (wantsPlaybackRef.current) {
                  // Keep the intent so "Join shared music" resumes in sync.
                  requestGesture();
                }
                target.cueVideoById({
                  videoId: latestRef.current.currentTrack.youtubeVideoId,
                  startSeconds: expectedPosition(),
                });
                setIsLoading(false);
              }
            },
            onStateChange: ({ data, target }) => {
              if (disposed) return;
              setIsPlaying(data === 1);
              setIsLoading(data === 3);
              if (data === 1) {
                loadingTrackRef.current = false;
                if (!wantsPlaybackRef.current) target.pauseVideo();
                setPlayerError('');
                setNeedsGesture(false);
              } else if (data === 0 && wantsPlaybackRef.current) {
                wantsPlaybackRef.current = false;
                lastTrackEndedRef.current = true;
                target.stopVideo();
                setIsPlaying(false);
                setIsLoading(false);
                if (roomId && !isSimulated) {
                  void apiRequest<{ music: RoomMusicState }>('/api/chat/music/next', {
                    roomId,
                    trackId: latestRef.current.currentTrack.id,
                    revision: appliedRevision.current,
                  })
                    .then(({ music }) => applyRemoteRef.current(music))
                    .catch((error: unknown) =>
                      setSyncError(
                        error instanceof Error ? error.message : 'The queue could not advance.',
                      ),
                    );
                } else {
                  const [nextTrack, ...remaining] = playQueueRef.current;
                  playQueueRef.current = remaining;
                  setPlayQueue(remaining);
                  if (nextTrack) startTrackRef.current(nextTrack, false, false, remaining);
                }
              }
            },
            onError: ({ data }) => {
              window.clearTimeout(timeout);
              // Non-embed errors on Apple devices while remote playback was
              // requested are usually autoplay gating, not a bad video: cue
              // and ask for a tap so the peer isn't stuck on an error card.
              if (
                !isEmbedForbiddenError(data) &&
                data !== 100 &&
                data !== 2 &&
                wantsPlaybackRef.current &&
                !hasGestureRef.current &&
                isIOSOrSafari()
              ) {
                try {
                  playerRef.current?.cueVideoById({
                    videoId: latestRef.current.currentTrack.youtubeVideoId,
                    startSeconds: expectedPosition(),
                  });
                } catch {
                  /* Cue is best effort; the join tap retries. */
                }
                requestGesture();
                return;
              }
              fail(getYouTubeErrorMessage(data));
            },
            onAutoplayBlocked: () => {
              loadingTrackRef.current = false;
              setIsPlaying(false);
              setIsLoading(false);
              setNeedsGesture(true);
            },
          },
        });
        playerRef.current = player;
      })
      .catch((error: Error) => {
        window.clearTimeout(timeout);
        fail(error.message);
      });

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      playerReadyRef.current = false;
      playerRef.current = null;
      player?.destroy();
    };
  }, [playerEnabled, playerAttempt, roomId, isSimulated]);

  const startTrack = (
    track: MusicTrack,
    resume = false,
    sync = true,
    queue = playQueueRef.current,
  ) => {
    markGesture();
    setNeedsGesture(false);
    const index = tracks.findIndex((item) => item.id === track.id);
    if (index < 0) {
      setTracks((previous) => [...previous, track]);
      setCurrentTrackIndex(tracks.length);
    } else setCurrentTrackIndex(index);
    playQueueRef.current = queue;
    setPlayQueue(queue);
    latestRef.current = { currentTrack: track, volume, isMuted };
    lastTrackEndedRef.current = false;
    hasSelectedTrackRef.current = true;
    wantsPlaybackRef.current = true;
    setPlayerError('');
    setIsLoading(true);
    loadingTrackRef.current = !resume;
    if (playerEnabled && playerError) {
      setPlayerAttempt((attempt) => attempt + 1);
    } else if (playerReadyRef.current && playerRef.current) {
      // Re-assert audibility on every resume: iOS/Safari can leave the
      // player muted (or at 0) after autoplay gating, so a bare playVideo()
      // would stay silent even though the UI shows playing.
      playerRef.current.setVolume(volume);
      if (isMuted) playerRef.current.mute();
      else playerRef.current.unMute();
      if (resume) playerRef.current.playVideo();
      else playerRef.current.loadVideoById(track.youtubeVideoId);
    } else {
      setPlayerEnabled(true);
    }
    if (sync)
      broadcast(
        {
          trackId: track.id,
          isPlaying: true,
          volume,
          isMuted,
          queue,
          ended: false,
          ...(!resume ? { position: 0 } : {}),
        },
        track,
      );
  };
  startTrackRef.current = startTrack;
  const syncQueue = (queue: MusicTrack[]) => {
    playQueueRef.current = queue;
    setPlayQueue(queue);
    if (hasCurrentTrack)
      broadcast(
        {
          trackId: currentTrack.id,
          isPlaying: wantsPlaybackRef.current,
          volume,
          isMuted,
          queue,
          ended: lastTrackEndedRef.current,
        },
        currentTrack,
      );
  };

  const togglePlay = () => {
    markGesture();
    setNeedsGesture(false);
    if (isPlaying || isLoading) {
      wantsPlaybackRef.current = false;
      if (playerReadyRef.current) playerRef.current?.pauseVideo();
      setIsLoading(false);
      setIsPlaying(false);
      if (hasCurrentTrack)
        broadcast({
          trackId: currentTrack.id,
          isPlaying: false,
          volume,
          isMuted,
          ended: false,
        });
    } else {
      const [nextTrack, ...remaining] = playQueueRef.current;
      if (nextTrack && (!hasCurrentTrack || lastTrackEndedRef.current))
        startTrack(nextTrack, false, true, remaining);
      else if (hasCurrentTrack) startTrack(currentTrack, true);
    }
  };

  const toggleMute = () => {
    const muted = !isMuted;
    if (!muted && volume === 0) {
      changeVolume(70);
      return;
    }
    setIsMuted(muted);
    if (playerReadyRef.current && playerRef.current) {
      if (muted) playerRef.current.mute();
      else playerRef.current.unMute();
    }
    if (hasCurrentTrack)
      broadcast({
        trackId: currentTrack.id,
        isPlaying: wantsPlaybackRef.current,
        volume,
        isMuted: muted,
      });
  };
  const changeVolume = (nextVolume: number) => {
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
    latestRef.current = { currentTrack, volume: nextVolume, isMuted: nextVolume === 0 };
    if (playerReadyRef.current && playerRef.current) {
      playerRef.current.setVolume(nextVolume);
      if (nextVolume === 0) playerRef.current.mute();
      else playerRef.current.unMute();
    }
    if (hasCurrentTrack)
      broadcast({
        trackId: currentTrack.id,
        isPlaying: wantsPlaybackRef.current,
        volume: nextVolume,
        isMuted: nextVolume === 0,
      });
  };

  const selectTrack = (track: MusicTrack) => {
    const index = tracks.findIndex((item) => item.id === track.id);
    if (index < 0) setTracks((previous) => [...previous, track]);
    setCurrentTrackIndex(index < 0 ? tracks.length : index);
    startTrack(track, false, true);
    setIsMenuOpen(false);
    menuButtonRef.current?.focus();
  };
  const addToQueue = (track: MusicTrack) => {
    if (playQueueRef.current.length >= MAX_MUSIC_QUEUE_LENGTH) {
      setSearchError(`The queue can hold up to ${MAX_MUSIC_QUEUE_LENGTH} songs.`);
      return;
    }
    if (!tracks.some((item) => item.id === track.id)) setTracks((previous) => [...previous, track]);
    const nextQueue = [...playQueueRef.current, track];
    const firstTrack = hasCurrentTrack ? undefined : nextQueue.shift();
    const remaining = nextQueue;
    if (firstTrack) {
      startTrack(firstTrack, false, true, remaining);
    } else syncQueue(remaining);
    setSearchError('');
  };
  const removeFromQueue = (index: number) =>
    syncQueue(playQueueRef.current.filter((_track, itemIndex) => itemIndex !== index));

  const searchMusic = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    searchRequestRef.current?.abort();
    const controller = new AbortController();
    searchRequestRef.current = controller;
    setSearchError('');
    setSearchResults([]);
    const videoId = extractYouTubeVideoId(query);
    if (videoId) {
      setIsSearching(false);
      selectTrack({
        id: `custom-${videoId}`,
        title: 'Custom YouTube track',
        artist: 'YouTube',
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
        youtubeVideoId: videoId,
        category: 'custom',
      });
      return;
    }
    setIsSearching(true);
    try {
      const response = await fetch('/api/music/search?q=' + encodeURIComponent(query), {
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed. Try again.');
      const results = (Array.isArray(data.tracks) ? data.tracks : [])
        .map(normalizeSharedTrack)
        .filter((track: MusicTrack | null): track is MusicTrack => !!track);
      if (controller.signal.aborted) return;
      setSearchResults(results);
      if (!results.length)
        setSearchError('No results. Try another search or paste a YouTube link.');
    } catch (error) {
      if (!controller.signal.aborted) setSearchError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  };

  const playbackActive = isPlaying && !isMuted && volume > 0;
  const playbackNotification = playerError || syncError;
  useEffect(() => {
    if (playbackNotification) setNotificationDismissed(false);
  }, [playbackNotification]);
  useEffect(() => {
    onAmbientChange?.({
      active: playbackActive,
      enabled: glowEnabled,
      color: glowColor,
      effect: isSpiderManTrack(currentTrack) ? 'spider-web' : 'aurora',
    });
  }, [currentTrack, glowColor, glowEnabled, onAmbientChange, playbackActive]);
  const updateGlowEnabled = (enabled: boolean) => {
    setGlowEnabled(enabled);
    try {
      localStorage.setItem('coursemates_music_glow', String(enabled));
    } catch {}
  };
  const updateGlowColor = (color: string) => {
    setGlowColor(color);
    try {
      localStorage.setItem('coursemates_music_glow_color', color);
    } catch {}
  };
  const panelAccent = isDarkMode ? `color-mix(in srgb, ${accent} 35%, #fafaf9)` : accent;
  const renderCatalogRow = (track: MusicTrack) => {
    const isActive = currentTrack.id === track.id;
    return (
      <div
        key={track.id}
        className={`flex w-full items-center gap-1 rounded-lg px-2 py-1 text-xs ${isActive ? 'bg-stone-100 dark:bg-white/10' : ''}`}
      >
        <button
          type="button"
          onClick={() => selectTrack(track)}
          aria-label={`Play ${track.title} by ${track.artist}`}
          aria-pressed={isActive}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors motion-reduce:transition-none ${isActive ? '' : 'text-stone-800 hover:bg-stone-100 dark:text-stone-100 dark:hover:bg-white/10'}`}
        >
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center">
            {isActive && playbackActive ? (
              <Pause className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{track.title}</span>
            <span className="block truncate text-[10px] text-stone-600 dark:text-stone-400">
              {track.artist}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={`Add ${track.title} to queue`}
          title="Add to queue"
          onClick={() => addToQueue(track)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <ListPlus className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div ref={menuRef} className="relative min-w-0">
      <div
        id="top-music-bar"
        role="group"
        aria-label="Study music controls"
        data-playing={playbackActive}
        style={
          compact
            ? undefined
            : {
                borderColor: `${accent}99`,
                ...(playbackActive
                  ? {
                      backgroundColor: isDarkMode
                        ? 'rgb(24 23 22 / 0.58)'
                        : 'rgb(255 255 255 / 0.58)',
                      boxShadow: `0 0 0 1px ${accent}55, 0 0 18px 2px ${accent}99`,
                    }
                  : {}),
              }
        }
        className={
          compact
            ? 'chat-display-control flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent shadow-none transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none'
            : `flex h-10 w-10 items-center justify-center rounded-xl border transition-[background-color,box-shadow,border-color] duration-500 backdrop-blur-md motion-reduce:transition-none ${playbackActive ? '' : isDarkMode ? 'border-stone-700' : 'border-stone-300'} ${isDarkMode ? 'bg-[#181716] text-stone-300' : 'bg-white text-stone-600'}`
        }
      >
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          aria-label="Open music controls"
          aria-expanded={isMenuOpen}
          aria-controls="music-tracks-dropdown"
          title={`Music controls: ${currentTrack.title}`}
          style={{ color: accent }}
          className={`flex cursor-pointer items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 ${compact ? 'chat-display-control h-8 w-8 border-0 bg-transparent shadow-none' : 'h-9 w-9 hover:bg-stone-500/10'}`}
        >
          {isLoading ? (
            <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <Music2 className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
          )}
        </button>
      </div>
      {isMenuOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5">
            <button
              type="button"
              aria-label="Close music controls"
              onClick={() => {
                setIsMenuOpen(false);
                menuButtonRef.current?.focus();
              }}
              className="absolute inset-0 cursor-default bg-black/20 backdrop-blur-[2px] dark:bg-black/45"
            />
            <section
              ref={dialogRef}
              id="music-tracks-dropdown"
              role="region"
              aria-label="Choose music"
              style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
              className="music-controls-panel relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-stone-300 bg-[#fffdfa] p-3 font-mono text-stone-800 shadow-2xl dark:border-[#383838] dark:bg-[#191919] dark:text-stone-200 sm:max-h-[calc(100dvh-2.5rem)] sm:p-4"
            >
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <div className="flex items-center gap-2">
                  <Music2 className="h-4 w-4" style={{ color: panelAccent }} />
                  <span className="text-sm font-bold">Music controls</span>
                </div>
                <button
                  type="button"
                  aria-label="Close music selection"
                  onClick={() => {
                    setIsMenuOpen(false);
                    menuButtonRef.current?.focus();
                  }}
                  className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto pr-1">
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 dark:border-[#363636] dark:bg-[#1f1f1f]">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${accent} ${isDarkMode ? 30 : 9}%, transparent)`,
                      color: panelAccent,
                    }}
                  >
                    {isLoading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    ) : playbackActive ? (
                      <Pause className="h-4 w-4 fill-current" />
                    ) : (
                      <Music2 className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-600 dark:text-stone-400">
                      {playbackActive ? 'Now playing' : 'Selected'}
                    </p>
                    <p
                      className="truncate text-xs font-bold text-stone-900 dark:text-stone-100"
                      title={currentTrack.title}
                    >
                      {currentTrack.title}
                    </p>
                    <p className="truncate text-[10px] text-stone-600 dark:text-stone-400">
                      {currentTrack.artist || 'Search YouTube to choose a song'}
                    </p>
                  </div>
                </div>
                <div
                  role="group"
                  aria-label="Music playback controls"
                  className="mb-4 border-b border-stone-200 pb-4 dark:border-[#363636]"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <button
                      id="music-play-toggle-btn"
                      type="button"
                      onClick={togglePlay}
                      aria-label={isPlaying || isLoading ? 'Pause Study Music' : 'Play Study Music'}
                      disabled={!hasCurrentTrack && playQueue.length === 0}
                      style={{ backgroundColor: accent }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.backgroundColor = accentHover;
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.backgroundColor = accent;
                      }}
                      className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]"
                    >
                      {isLoading ? (
                        <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      ) : isPlaying ? (
                        <Pause className="h-4 w-4 fill-current" />
                      ) : (
                        <Play className="h-4 w-4 fill-current" />
                      )}
                      {isPlaying || isLoading ? 'Pause' : 'Play'}
                    </button>
                    <button
                      id="music-mute-btn"
                      type="button"
                      onClick={toggleMute}
                      aria-label={isMuted ? 'Unmute music' : 'Mute music'}
                      aria-pressed={isMuted}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-500 dark:bg-[#1c1c1c] dark:text-stone-100 dark:hover:bg-[#292929]"
                    >
                      {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label="Restart shared track"
                      onClick={() => startTrack(currentTrack)}
                      disabled={!hasCurrentTrack}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-500 dark:text-stone-100 dark:hover:bg-white/10"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={isMuted ? 0 : volume}
                      onChange={(event) => changeVolume(Number(event.target.value))}
                      aria-label="Music volume"
                      style={{ accentColor: panelAccent }}
                      className="h-8 min-w-0 flex-1 cursor-pointer"
                    />
                    <span className="w-9 text-right text-[11px] tabular-nums text-stone-600 dark:text-stone-300">
                      {isMuted ? 0 : volume}%
                    </span>
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4 text-xs dark:border-[#363636]">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={glowEnabled}
                      onChange={(event) => updateGlowEnabled(event.target.checked)}
                      className="h-3.5 w-3.5 accent-teal-500"
                    />
                    <span className="font-bold">Ambient glow</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-stone-600 dark:text-stone-400">Custom</span>
                    <input
                      type="color"
                      value={glowColor}
                      onChange={(event) => updateGlowColor(event.target.value)}
                      aria-label="Custom ambient glow color"
                      className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                    />
                  </label>
                </div>
                <div className="mb-4 border-b border-stone-200 pb-4 dark:border-[#363636]">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold">Aurora color</span>
                    <span className="text-[10px] text-stone-600 dark:text-stone-400">
                      {AMBIENT_GLOW_COLORS.find(
                        (option) => option.color.toLowerCase() === glowColor.toLowerCase(),
                      )?.name || 'Custom color'}
                    </span>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {AMBIENT_GLOW_COLORS.map((option) => (
                      <button
                        key={option.color}
                        type="button"
                        aria-label={`Use ${option.name} aurora color`}
                        aria-pressed={glowColor.toLowerCase() === option.color.toLowerCase()}
                        title={option.name}
                        onClick={() => updateGlowColor(option.color)}
                        className="group flex h-8 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 dark:border-stone-600 dark:bg-[#202020] motion-reduce:transition-none motion-reduce:hover:scale-100"
                        style={{
                          outlineColor: option.color,
                          borderColor:
                            glowColor.toLowerCase() === option.color.toLowerCase()
                              ? option.color
                              : undefined,
                          boxShadow:
                            glowColor.toLowerCase() === option.color.toLowerCase()
                              ? `0 0 12px ${option.color}99`
                              : undefined,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 rounded-full border border-white/40 shadow-[0_0_10px_currentColor] transition-transform group-hover:scale-110"
                          style={{ backgroundColor: option.color, color: option.color }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <form onSubmit={searchMusic} className="flex gap-2">
                  <input
                    ref={searchRef}
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Search music or paste a YouTube link"
                    placeholder="Search or paste a YouTube link"
                    style={{ borderColor: panelAccent }}
                    className="w-full min-w-0 rounded-lg border bg-white px-3 py-2.5 text-xs text-stone-900 outline-none placeholder:text-stone-500 dark:bg-transparent dark:text-stone-100 dark:placeholder:text-stone-400"
                  />
                  <button
                    type="submit"
                    aria-label="Go"
                    disabled={isSearching}
                    style={{ backgroundColor: accent }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = accentHover;
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = accent;
                    }}
                    className="flex min-w-11 items-center justify-center rounded-lg px-4 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {isSearching ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      'Go'
                    )}
                  </button>
                </form>
                {isSearching && (
                  <p role="status" className="mt-2 text-xs text-stone-600 dark:text-stone-400">
                    Searching the catalog…
                  </p>
                )}
                {searchError && (
                  <p role="status" className="mt-2 text-xs text-red-700 dark:text-red-400">
                    {searchError}
                  </p>
                )}
                <div className="mt-3 space-y-1">
                  {searchResults.length > 0 && (
                    <>
                      <p className="flex items-center justify-between px-2.5 py-1 text-[10px] uppercase tracking-wide text-stone-600 dark:text-stone-400">
                        <span>Search results</span>
                        <span>{searchResults.length}</span>
                      </p>
                      {searchResults.map(renderCatalogRow)}
                    </>
                  )}
                  {searchResults.length === 0 && (
                    <p className="px-2.5 py-3 text-xs text-stone-600 dark:text-stone-400">
                      Search YouTube or paste a video link to play or queue a song.
                    </p>
                  )}
                </div>
                <div
                  role="group"
                  aria-label="Music queue"
                  className="mt-3 border-t border-stone-200 pt-3 dark:border-[#363636]"
                >
                  <div className="mb-2 flex items-center justify-between px-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-stone-600 dark:text-stone-400">
                      Up next ({playQueue.length})
                    </span>
                    {playQueue.length > 0 && (
                      <button
                        type="button"
                        onClick={() => syncQueue([])}
                        className="rounded px-2 py-1 text-[10px] text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10"
                      >
                        Clear queue
                      </button>
                    )}
                  </div>
                  {playQueue.map((track, index) => (
                    <div
                      key={`${track.id}-${index}`}
                      className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                    >
                      <span className="w-4 shrink-0 text-right text-[10px] text-stone-500">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{track.title}</span>
                        <span className="block truncate text-[10px] text-stone-600 dark:text-stone-400">
                          {track.artist}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${track.title} from queue`}
                        onClick={() => removeFromQueue(index)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-white/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {playQueue.length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-stone-600 dark:text-stone-400">
                      Queue is empty. Add songs from your search results.
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {needsGesture &&
        !playbackNotification &&
        !notificationDismissed &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              role="status"
              className={`pointer-events-auto relative z-10 w-full max-w-sm rounded-xl border p-4 shadow-2xl ${isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-200' : 'border-stone-300 bg-white text-stone-800'}`}
            >
              <div className="flex items-start gap-3">
                <Music2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: accent }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Enable music playback</p>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Enable sound on this device to join your peer at the current playback position.
                  </p>
                  <button
                    id="music-join-btn"
                    type="button"
                    onClick={() => {
                      setNeedsGesture(false);
                      if (playerReadyRef.current)
                        playerRef.current?.seekTo(expectedPosition(), true);
                      startTrack(currentTrack, true, false);
                    }}
                    className="mt-3 rounded-lg bg-[var(--chat-accent)] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Join shared music
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Close music notification"
                  onClick={() => setNotificationDismissed(true)}
                  className="rounded-lg p-1.5 hover:bg-red-500/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {playbackNotification &&
        !notificationDismissed &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              role="alert"
              className={`pointer-events-auto relative z-10 w-full max-w-sm rounded-xl border p-4 shadow-2xl ${isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-200' : 'border-stone-300 bg-white text-stone-800'}`}
            >
              <div className="flex items-start gap-3">
                <Music2 className="mt-0.5 h-5 w-5 shrink-0 text-[#991B1B] dark:text-red-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Music could not play</p>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {playbackNotification}
                  </p>
                  {hasCurrentTrack && (
                    <button
                      id="music-retry-btn"
                      type="button"
                      onClick={() => {
                        setNotificationDismissed(true);
                        setPlayerError('');
                        setSyncError('');
                        if (playerReadyRef.current)
                          playerRef.current?.seekTo(expectedPosition(), true);
                        startTrack(currentTrack, true, false);
                      }}
                      className="mt-3 rounded-lg bg-[var(--chat-accent)] px-4 py-2 text-sm font-semibold text-white"
                    >
                      Tap to retry with sound
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Close music notification"
                  onClick={() => setNotificationDismissed(true)}
                  className="rounded-lg p-1.5 hover:bg-red-500/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {playerEnabled && (
        <div
          ref={playerHostRef}
          data-testid="music-engine"
          aria-hidden="true"
          inert
          // Offscreen but full-size: iOS/Safari suspends 1px/clipped iframes,
          // which surfaced as "Music could not play" for the remote peer.
          // Opacity + inert + aria-hidden keep it audio-only (tests assert this).
          className="pointer-events-none fixed top-0 h-[180px] w-[320px] max-w-none overflow-hidden opacity-0"
          style={{ left: -9999 }}
        />
      )}
    </div>
  );
});
