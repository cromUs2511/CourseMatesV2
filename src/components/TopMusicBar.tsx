import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, LoaderCircle, Music2, X } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { MusicTrack, RoomMusicState } from '../types';
import { DEFAULT_MUSIC_DIRECTORY, extractYouTubeVideoId, normalizeSharedTrack } from '../data/musicDirectory';
import { getYouTubeErrorMessage, loadYouTubeAPI, YouTubePlayer } from '../utils/youtubePlayer';

interface TopMusicBarProps {
  isDarkMode: boolean;
  roomId?: string;
  ws?: WebSocket;
  isSimulated?: boolean;
  token?: string;
  remoteMusic?: RoomMusicState;
  onAmbientChange?: (ambient: { active: boolean; enabled: boolean; color: string }) => void;
  accent?: string;
  accentHover?: string;
}

export const TopMusicBar: React.FC<TopMusicBarProps> = ({ isDarkMode, roomId, ws, isSimulated, token, remoteMusic, onAmbientChange, accent = '#991B1B', accentHover = '#7F1D1D' }) => {
  const [tracks, setTracks] = useState<MusicTrack[]>(DEFAULT_MUSIC_DIRECTORY);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
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
    try { return localStorage.getItem('coursemates_music_glow') !== 'false'; } catch { return true; }
  });
  const [glowColor, setGlowColor] = useState(() => {
    try { return localStorage.getItem('coursemates_music_glow_color') || '#6ee7b7'; } catch { return '#6ee7b7'; }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef<AbortController | null>(null);

  useEffect(() => () => searchRequestRef.current?.abort(), []);
  useEffect(() => {
    if (!isMenuOpen) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !dialogRef.current?.contains(target)) setIsMenuOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsMenuOpen(false); menuButtonRef.current?.focus(); }
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
  const loadingTrackRef = useRef(false);
  const hasSelectedTrackRef = useRef(false);
  const appliedRevision = useRef(0);
  const updateQueue = useRef(Promise.resolve());
  const [syncError, setSyncError] = useState('');
  const [needsGesture, setNeedsGesture] = useState(false);
  const broadcast = (state: { trackId: string; isPlaying: boolean; volume: number; isMuted: boolean }, track = tracks.find(item => item.id === state.trackId)) => {
    if (!roomId || isSimulated) return;
    if (!token) {
      setSyncError('Music could not sync because your session has expired.');
      return;
    }
    setSyncError('');
    updateQueue.current = updateQueue.current.then(async () => {
      try {
        const payload = { roomId, ...state, ...(track ? { track } : {}) };
        let data: { music: RoomMusicState } | null = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            data = await apiRequest<{ music: RoomMusicState }>('/api/chat/music', token, payload);
            break;
          } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise(resolve => window.setTimeout(resolve, 250));
          }
        }
        if (!data) throw lastError instanceof Error ? lastError : new Error('Music could not sync.');
        appliedRevision.current = Math.max(appliedRevision.current, data.music.revision);
        setSyncError('');
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : 'Music could not sync. Press Play or Pause to try again.');
      }
    });
  };

  const broadcastRef = useRef(broadcast);
  broadcastRef.current = broadcast;

  const currentTrack = tracks[currentTrackIndex] || tracks[0];
  const latestRef = useRef({ currentTrack, isMuted, volume });
  latestRef.current = { currentTrack, isMuted, volume };

  useEffect(() => {
    const applyRemote = (remote: RoomMusicState) => {
      try {
        if (remote.revision <= appliedRevision.current) return;
        let index = tracks.findIndex(track => track.id === remote.trackId);
        const sharedTrack = normalizeSharedTrack(remote.track);
        const track = sharedTrack?.id === remote.trackId ? sharedTrack : tracks[index];
        if (!track) return;
        appliedRevision.current = remote.revision;
        if (index < 0) {
          index = tracks.length;
          setTracks(previous => [...previous, track]);
        }
        hasSelectedTrackRef.current = true;
        const trackChanged = latestRef.current.currentTrack.youtubeVideoId !== track.youtubeVideoId;
        latestRef.current = { currentTrack: track, volume: remote.volume, isMuted: remote.isMuted };
        setPlayerError('');
        setCurrentTrackIndex(index);
        setVolume(remote.volume);
        setIsMuted(remote.isMuted);
        wantsPlaybackRef.current = remote.isPlaying;
        setIsLoading(remote.isPlaying);
        if (playerReadyRef.current && playerRef.current) {
          playerRef.current.setVolume(remote.volume);
          if (remote.isMuted) playerRef.current.mute(); else playerRef.current.unMute();
          if (trackChanged) {
            loadingTrackRef.current = remote.isPlaying;
            if (remote.isPlaying) playerRef.current.loadVideoById(track.youtubeVideoId);
            else playerRef.current.cueVideoById(track.youtubeVideoId);
          } else if (remote.isPlaying) playerRef.current.playVideo();
          else playerRef.current.pauseVideo();
        } else {
          setPlayerEnabled(true);
        }
      } catch { /* Ignore malformed room events. */ }
    };
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'music_state' && data.roomId === roomId && data.music) applyRemote(data.music);
      } catch { /* Polling recovers missed events. */ }
    };
    if (remoteMusic) applyRemote(remoteMusic);
    ws?.addEventListener('message', onMessage);
    return () => ws?.removeEventListener('message', onMessage);
  }, [roomId, tracks, ws, remoteMusic]);

  useEffect(() => {
    // Fetch custom directory from server if available
    const controller = new AbortController();
    fetch('/api/music/directory', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Directory unavailable');
        return res.json();
      })
      .then((data) => {
        // A slow directory response must not replace a user's selected/custom track.
        if (!controller.signal.aborted && !hasSelectedTrackRef.current && Array.isArray(data.tracks)) {
          const validTracks = data.tracks.filter((track: unknown): track is MusicTrack => {
            if (!track || typeof track !== 'object') return false;
            const candidate = track as Partial<MusicTrack>;
            return typeof candidate.id === 'string' &&
              typeof candidate.title === 'string' &&
              typeof candidate.artist === 'string' &&
              typeof candidate.youtubeUrl === 'string' &&
              ['lofi', 'ambient', 'piano', 'synthwave', 'chill', 'classical', 'custom'].includes(candidate.category ?? '') &&
              typeof candidate.youtubeVideoId === 'string' &&
              /^[a-zA-Z0-9_-]{11}$/.test(candidate.youtubeVideoId);
          });
          if (validTracks.length > 0) setTracks(validTracks);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Unable to load the music directory.', error);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!playerEnabled) return;
    let disposed = false;
    let player: YouTubePlayer | null = null;
    playerReadyRef.current = false;
    const fail = (message: string) => {
      if (disposed) return;
      wantsPlaybackRef.current = false;
      setIsPlaying(false);
      setIsLoading(false);
      setPlayerError(message);
    };
    const timeout = window.setTimeout(() => {
      fail('YouTube is taking too long to load. Check your connection, then press Play to retry.');
    }, 20000);

    loadYouTubeAPI().then((api) => {
      if (disposed || !playerHostRef.current) return;
      // YouTube replaces this child, leaving React's host element intact.
      const mount = document.createElement('div');
      playerHostRef.current.replaceChildren(mount);
      player = new api.Player(mount, {
        width: 320,
        height: 200,
        videoId: latestRef.current.currentTrack.youtubeVideoId,
        playerVars: { playsinline: 1, controls: 0, origin: window.location.origin },
        events: {
          onReady: ({ target }) => {
            if (disposed) return;
            window.clearTimeout(timeout);
            playerReadyRef.current = true;
            target.setVolume(latestRef.current.volume);
            if (latestRef.current.isMuted) target.mute();
            else target.unMute();
            if (wantsPlaybackRef.current) {
              loadingTrackRef.current = true;
              target.loadVideoById(latestRef.current.currentTrack.youtubeVideoId);
            } else {
              target.cueVideoById(latestRef.current.currentTrack.youtubeVideoId);
              setIsLoading(false);
            }
          },
          onStateChange: ({ data, target }) => {
            if (disposed) return;
            setIsPlaying(data === 1);
            setIsLoading(data === 3);
            if (data === 1) {
              loadingTrackRef.current = false;
              if (!wantsPlaybackRef.current) {
                const latest = latestRef.current;
                broadcastRef.current({ trackId: latest.currentTrack.id, isPlaying: true, volume: latest.volume, isMuted: latest.isMuted }, latest.currentTrack);
              }
              wantsPlaybackRef.current = true;
              setPlayerError('');
              setNeedsGesture(false);
            } else if (data === 2 && wantsPlaybackRef.current && !loadingTrackRef.current) {
              wantsPlaybackRef.current = false;
              const latest = latestRef.current;
              broadcastRef.current({ trackId: latest.currentTrack.id, isPlaying: false, volume: latest.volume, isMuted: latest.isMuted }, latest.currentTrack);
            } else if (data === 0 && wantsPlaybackRef.current) {
              target.playVideo();
            }
          },
          onError: ({ data }) => {
            window.clearTimeout(timeout);
            fail(getYouTubeErrorMessage(data));
          },
          onAutoplayBlocked: () => {
            setIsPlaying(false);
            setIsLoading(false);
            setNeedsGesture(true);
          },
        },
      });
      playerRef.current = player;
    }).catch((error: Error) => {
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
  }, [playerEnabled, playerAttempt]);

  const startTrack = (track: MusicTrack, resume = false, sync = true) => {
    latestRef.current = { currentTrack: track, volume, isMuted };
    hasSelectedTrackRef.current = true;
    wantsPlaybackRef.current = true;
    setPlayerError('');
    setIsLoading(true);
    loadingTrackRef.current = !resume;
    if (playerEnabled && playerError) {
      setPlayerAttempt((attempt) => attempt + 1);
    } else if (playerReadyRef.current && playerRef.current) {
      if (resume) playerRef.current.playVideo();
      else playerRef.current.loadVideoById(track.youtubeVideoId);
    } else {
      setPlayerEnabled(true);
    }
    if (sync) broadcast({ trackId: track.id, isPlaying: true, volume, isMuted }, track);
  };

  const togglePlay = () => {
    if (isPlaying || isLoading) {
      wantsPlaybackRef.current = false;
      if (playerReadyRef.current) playerRef.current?.pauseVideo();
      setIsLoading(false);
      setIsPlaying(false);
      broadcast({ trackId: currentTrack.id, isPlaying: false, volume, isMuted });
    } else {
      startTrack(currentTrack, true);
    }
  };

  const toggleMute = () => {
    const muted = !isMuted;
    if (!muted && volume === 0) { changeVolume(70); return; }
    setIsMuted(muted);
    if (playerReadyRef.current && playerRef.current) {
      if (muted) playerRef.current.mute();
      else playerRef.current.unMute();
    }
    broadcast({ trackId: currentTrack.id, isPlaying: wantsPlaybackRef.current, volume, isMuted: muted });
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
    broadcast({ trackId: currentTrack.id, isPlaying: wantsPlaybackRef.current, volume: nextVolume, isMuted: nextVolume === 0 });
  };

  const selectTrack = (track: MusicTrack) => {
    const index = tracks.findIndex(item => item.id === track.id);
    if (index < 0) setTracks(previous => [...previous, track]);
    setCurrentTrackIndex(index < 0 ? tracks.length : index);
    startTrack(track);
    setIsMenuOpen(false);
    menuButtonRef.current?.focus();
  };

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
      selectTrack({ id: `custom-${videoId}`, title: 'Custom YouTube track', artist: 'YouTube', youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`, youtubeVideoId: videoId, category: 'custom' });
      return;
    }
    setIsSearching(true);
    try {
      const response = await fetch('/api/music/search?q=' + encodeURIComponent(query), { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed. Try again.');
      const results = (Array.isArray(data.tracks) ? data.tracks : []).map(normalizeSharedTrack).filter((track: MusicTrack | null): track is MusicTrack => !!track);
      if (controller.signal.aborted) return;
      setSearchResults(results);
      if (!results.length) setSearchError('No results. Try another search or paste a YouTube link.');
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
    onAmbientChange?.({ active: playbackActive, enabled: glowEnabled, color: glowColor });
  }, [glowColor, glowEnabled, onAmbientChange, playbackActive]);
  const updateGlowEnabled = (enabled: boolean) => {
    setGlowEnabled(enabled);
    try { localStorage.setItem('coursemates_music_glow', String(enabled)); } catch {}
  };
  const updateGlowColor = (color: string) => {
    setGlowColor(color);
    try { localStorage.setItem('coursemates_music_glow_color', color); } catch {}
  };

  return (
    <div ref={menuRef} className="relative min-w-0">
      <div
        id="top-music-bar"
        role="group"
        aria-label="Study music controls"
        data-playing={playbackActive}
        className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-[box-shadow,border-color] duration-500 motion-reduce:transition-none ${
          playbackActive ? 'border-red-500/60 shadow-[0_0_18px_2px_rgba(239,68,68,0.25)]' : isDarkMode ? 'border-stone-700' : 'border-stone-300'
        } ${isDarkMode ? 'bg-[#181716] text-stone-300' : 'bg-white text-stone-600'}`}
      >
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMenuOpen(open => !open)}
          aria-label="Open music controls"
          aria-expanded={isMenuOpen}
          aria-controls="music-tracks-dropdown"
          title={`Music controls: ${currentTrack.title}`}
          style={{ color: accent }}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg hover:bg-stone-500/10 focus-visible:outline focus-visible:outline-2"
        >
          {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Music2 className="h-5 w-5" />}
        </button>
      </div>
      {isMenuOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5">
          <button
            type="button"
            aria-label="Close music controls"
            onClick={() => { setIsMenuOpen(false); menuButtonRef.current?.focus(); }}
            className="absolute inset-0 cursor-default bg-black/20 backdrop-blur-[2px] dark:bg-black/45"
          />
          <section
            ref={dialogRef}
            id="music-tracks-dropdown"
            role="region"
            aria-label="Choose music"
            className={`relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border p-3 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:p-4 ${isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-200' : 'border-stone-300 bg-white text-stone-800'}`}
          >
            <div className="mb-3 flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <Music2 className="h-4 w-4" style={{ color: accent }} />
                <span className="text-sm font-semibold">Music controls</span>
              </div>
              <button type="button" aria-label="Close music selection" onClick={() => { setIsMenuOpen(false); menuButtonRef.current?.focus(); }} className="rounded-lg p-2 hover:bg-stone-500/10"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 overflow-y-auto pr-0.5">
              <p className="mb-3 truncate text-xs text-stone-500" title={currentTrack.title}>Selected: {currentTrack.title}</p>
              <div className="mb-3 flex items-center gap-2">
                <button
                  id="music-play-toggle-btn"
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying || isLoading ? 'Pause Study Music' : 'Play Study Music'}
                  style={{ backgroundColor: accent }}
                  onMouseEnter={event => { event.currentTarget.style.backgroundColor = accentHover; }}
                  onMouseLeave={event => { event.currentTarget.style.backgroundColor = accent; }}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white"
                >
                  {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                  {isPlaying || isLoading ? 'Pause' : 'Play'}
                </button>
                <button
                  id="music-mute-btn"
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute music' : 'Mute music'}
                  aria-pressed={isMuted}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-400/40"
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
              </div>
              <div className="mb-4 flex items-center gap-2">
                <input type="range" min="0" max="100" value={isMuted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Music volume" style={{ accentColor: accent }} className="h-8 min-w-0 flex-1 cursor-pointer" />
                <span className="w-9 text-right text-[11px] tabular-nums">{isMuted ? 0 : volume}%</span>
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-400/20 pt-3 text-xs">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={glowEnabled} onChange={(event) => updateGlowEnabled(event.target.checked)} />
                  Ambient glow
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-stone-500">Color</span>
                  <input type="color" value={glowColor} onChange={(event) => updateGlowColor(event.target.value)} aria-label="Ambient glow color" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
                </label>
              </div>
              <form onSubmit={searchMusic} className="flex gap-2">
                <input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search music or paste a YouTube link" placeholder="Search or paste a YouTube link" className="w-full min-w-0 rounded-lg border border-stone-400/40 bg-transparent px-3 py-2.5 text-xs outline-none focus:border-red-500" />
                <button type="submit" aria-label="Go" style={{ backgroundColor: accent }} onMouseEnter={event => { event.currentTarget.style.backgroundColor = accentHover; }} onMouseLeave={event => { event.currentTarget.style.backgroundColor = accent; }} className="rounded-lg px-4 text-xs text-white disabled:opacity-50">Go</button>
              </form>
              {searchError && <p role="status" className="mt-2 text-xs text-red-500">{searchError}</p>}
              <div className="mt-3 space-y-1">
                {searchResults.length > 0 && <p className="px-2 py-1 text-[10px] uppercase text-stone-500">Search results</p>}
                {[...searchResults, ...tracks].filter((track, index, all) => all.findIndex(item => item.id === track.id) === index).map(track => (
                  <button key={track.id} type="button" onClick={() => selectTrack(track)} aria-pressed={currentTrack.id === track.id} className={`block w-full rounded-lg px-3 py-2 text-left text-xs ${currentTrack.id === track.id ? 'bg-red-500/15 text-red-500' : 'hover:bg-stone-500/10'}`}>
                    <span className="block truncate font-medium">{track.title}</span>
                    <span className="block truncate text-[10px] text-stone-500">{track.artist}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}
      {needsGesture && !playbackNotification && !notificationDismissed && createPortal(
        <div className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4" role="presentation">
          <div role="status" className={`pointer-events-auto relative z-10 w-full max-w-sm rounded-xl border p-4 shadow-2xl ${isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-200' : 'border-stone-300 bg-white text-stone-800'}`}>
            <div className="flex items-start gap-3">
              <Music2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: accent }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Enable music playback</p>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Press Play to enable sound on this device.</p>
              </div>
              <button type="button" aria-label="Close music notification" onClick={() => setNotificationDismissed(true)} className="rounded-lg p-1.5 hover:bg-red-500/10">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {playbackNotification && !notificationDismissed && createPortal(
        <div className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4" role="presentation">
          <div role="alert" className={`pointer-events-auto relative z-10 w-full max-w-sm rounded-xl border p-4 shadow-2xl ${isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-200' : 'border-stone-300 bg-white text-stone-800'}`}>
            <div className="flex items-start gap-3">
              <Music2 className="mt-0.5 h-5 w-5 shrink-0 text-[#991B1B] dark:text-red-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Music could not play</p>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{playbackNotification}</p>
              </div>
              <button type="button" aria-label="Close music notification" onClick={() => setNotificationDismissed(true)} className="rounded-lg p-1.5 hover:bg-red-500/10">
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
          className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 [clip-path:inset(50%)]"
        />
      )}
    </div>
  );
};
