import React, { useState, useEffect, useRef } from 'react';
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
}

export const TopMusicBar: React.FC<TopMusicBarProps> = ({ isDarkMode, roomId, ws, isSimulated, token, remoteMusic }) => {
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
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef<AbortController | null>(null);

  useEffect(() => () => searchRequestRef.current?.abort(), []);
  useEffect(() => {
    if (!isMenuOpen) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
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
  const pendingUpdates = useRef(0);
  const updateQueue = useRef(Promise.resolve());
  const [syncError, setSyncError] = useState('');
  const [needsGesture, setNeedsGesture] = useState(false);
  const broadcast = (state: { trackId: string; isPlaying: boolean; volume: number; isMuted: boolean }, track = tracks.find(item => item.id === state.trackId)) => {
    if (!roomId || isSimulated) return;
    pendingUpdates.current++;
    updateQueue.current = updateQueue.current.then(async () => {
      try {
        const data = await apiRequest<{ music: RoomMusicState }>('/api/chat/music', token, { roomId, ...state, track });
        appliedRevision.current = Math.max(appliedRevision.current, data.music.revision);
        setSyncError('');
      } catch {
        setSyncError('Music could not sync. Press Play or Pause to try again.');
      } finally { pendingUpdates.current--; }
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
        if (pendingUpdates.current || remote.revision <= appliedRevision.current) return;
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

  return (
    <div ref={menuRef} className="relative w-[280px] max-w-full min-w-0">
      <div
        id="top-music-bar"
        role="group"
        aria-label="Study music controls"
        data-playing={playbackActive}
        className={`flex h-11 items-center gap-1 rounded-xl border px-1.5 transition-[box-shadow,border-color] duration-500 motion-reduce:transition-none sm:h-9 ${
          playbackActive ? 'border-red-500/60 shadow-[0_0_18px_2px_rgba(239,68,68,0.25)]' : isDarkMode ? 'border-stone-700' : 'border-stone-300'
        } ${isDarkMode ? 'bg-[#181716] text-stone-300' : 'bg-white text-stone-600'}`}
      >
        <button
          id="music-play-toggle-btn"
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying || isLoading ? 'Pause Study Music' : 'Play Study Music'}
          title={isPlaying || isLoading ? 'Pause music' : 'Play music'}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-red-600 hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 sm:h-7 sm:w-7 dark:text-red-400"
        >
          {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMenuOpen(open => !open)}
          aria-label="Choose or search music"
          aria-expanded={isMenuOpen}
          aria-controls="music-tracks-dropdown"
          title={`Choose or search music ? ${currentTrack.title}`}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 sm:h-7 sm:w-7"
        >
          <Music2 className="h-4 w-4" />
        </button>
        <button
          id="music-mute-btn"
          type="button"
          onClick={toggleMute}
          aria-label={isMuted ? 'Unmute music' : 'Mute music'}
          aria-pressed={isMuted}
          title={isMuted ? 'Unmute music' : 'Mute music'}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 sm:h-7 sm:w-7 dark:hover:bg-stone-800"
        >
          {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : volume}
          onChange={(event) => changeVolume(Number(event.target.value))}
          aria-label="Music volume"
          className="h-8 min-w-0 flex-1 cursor-pointer accent-[#991B1B]"
        />
        <span className="w-9 shrink-0 pr-1 text-right text-[11px] tabular-nums">{isMuted ? 0 : volume}%</span>
      </div>
      {isMenuOpen && (
        <section
          id="music-tracks-dropdown"
          aria-label="Choose music"
          className={`absolute left-0 top-full z-50 mt-2 max-h-[min(360px,50dvh)] w-[min(320px,calc(100vw-3rem))] overflow-y-auto rounded-xl border p-3 shadow-xl ${isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-200' : 'border-stone-300 bg-white text-stone-800'}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">Choose music</span>
            <button type="button" aria-label="Close music selection" onClick={() => { setIsMenuOpen(false); menuButtonRef.current?.focus(); }} className="rounded p-2 hover:bg-red-500/10"><X className="h-4 w-4" /></button>
          </div>
          <p className="mb-3 truncate text-xs text-stone-500" title={currentTrack.title}>Selected: {currentTrack.title}</p>
          <form onSubmit={searchMusic} className="flex gap-2">
            <input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search music or paste a YouTube link" placeholder="Search or paste a YouTube link" className="w-full min-w-0 rounded-lg border border-stone-400/40 bg-transparent px-2 py-2 text-xs outline-none focus:border-red-500" />
            <button type="submit" disabled={isSearching || !search.trim()} className="rounded-lg bg-[#991B1B] px-3 text-xs text-white disabled:opacity-50">{isSearching ? 'Searching?' : 'Go'}</button>
          </form>
          {searchError && <p role="status" className="mt-2 text-xs text-red-500">{searchError}</p>}
          <div className="mt-3 space-y-1">
            {searchResults.length > 0 && <p className="px-2 py-1 text-[10px] uppercase text-stone-500">Search results</p>}
            {[...searchResults, ...tracks].filter((track, index, all) => all.findIndex(item => item.id === track.id) === index).map(track => (
              <button key={track.id} type="button" onClick={() => selectTrack(track)} aria-pressed={currentTrack.id === track.id} className={`block w-full rounded-lg px-2 py-2 text-left text-xs ${currentTrack.id === track.id ? 'bg-red-500/15 text-red-500' : 'hover:bg-stone-500/10'}`}>
                <span className="block truncate font-medium">{track.title}</span>
                <span className="block truncate text-[10px] text-stone-500">{track.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {(playerError || syncError || needsGesture) && (
        <p role="status" className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          {playerError || syncError || 'Press Play to enable sound on this device.'}
        </p>
      )}
      {/* Keep playback mounted without exposing video or native controls at any viewport size. */}
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
