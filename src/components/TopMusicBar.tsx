import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, Volume2, VolumeX, ChevronDown, Music, LoaderCircle } from 'lucide-react';
import { MusicTrack } from '../types';
import { DEFAULT_MUSIC_DIRECTORY, extractYouTubeVideoId } from '../data/musicDirectory';
import { getYouTubeErrorMessage, loadYouTubeAPI, YouTubePlayer } from '../utils/youtubePlayer';

interface TopMusicBarProps {
  isDarkMode: boolean;
  roomId?: string;
  ws?: WebSocket;
  isSimulated?: boolean;
}

export const TopMusicBar: React.FC<TopMusicBarProps> = ({ isDarkMode, roomId, ws, isSimulated }) => {
  const [tracks, setTracks] = useState<MusicTrack[]>(DEFAULT_MUSIC_DIRECTORY);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState(70);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [search, setSearch] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [playerEnabled, setPlayerEnabled] = useState(false);
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playerReadyRef = useRef(false);
  const wantsPlaybackRef = useRef(false);
  const hasSelectedTrackRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const broadcast = (state: { trackId: string; isPlaying: boolean; volume: number; isMuted: boolean }) => {
    if (!roomId || isSimulated || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'music_update', roomId, ...state }));
  };

  const currentTrack = tracks[currentTrackIndex] || tracks[0];
  const latestRef = useRef({ currentTrack, isMuted, volume });
  latestRef.current = { currentTrack, isMuted, volume };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'music_state' || data.roomId !== roomId || !data.music) return;
        const remote = data.music as { trackId: string; isPlaying: boolean; volume: number; isMuted: boolean };
        const index = tracks.findIndex(track => track.id === remote.trackId);
        if (index < 0) return;
        setCurrentTrackIndex(index);
        setVolume(remote.volume);
        setIsMuted(remote.isMuted);
        wantsPlaybackRef.current = remote.isPlaying;
        setIsLoading(remote.isPlaying);
        if (playerReadyRef.current && playerRef.current) {
          playerRef.current.setVolume(remote.volume);
          if (remote.isMuted) playerRef.current.mute(); else playerRef.current.unMute();
          if (remote.isPlaying) playerRef.current.loadVideoById(tracks[index].youtubeVideoId);
          else playerRef.current.pauseVideo();
        } else {
          setPlayerEnabled(true);
        }
      } catch { /* Ignore malformed room events. */ }
    };
    ws?.addEventListener('message', onMessage);
    return () => ws?.removeEventListener('message', onMessage);
  }, [roomId, tracks, ws]);

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
        playerVars: { playsinline: 1, controls: 1, origin: window.location.origin },
        events: {
          onReady: ({ target }) => {
            if (disposed) return;
            window.clearTimeout(timeout);
            playerReadyRef.current = true;
            target.setVolume(latestRef.current.volume);
            if (latestRef.current.isMuted) target.mute();
            else target.unMute();
            if (wantsPlaybackRef.current) {
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
              wantsPlaybackRef.current = true;
              setPlayerError('');
            } else if (data === 2) {
              wantsPlaybackRef.current = false;
            } else if (data === 0 && wantsPlaybackRef.current) {
              target.playVideo();
            }
          },
          onError: ({ data }) => {
            window.clearTimeout(timeout);
            fail(getYouTubeErrorMessage(data));
          },
          onAutoplayBlocked: () => {
            fail('Your browser blocked playback. Press Play in the YouTube player below.');
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

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const startTrack = (track: MusicTrack, resume = false, sync = true) => {
    hasSelectedTrackRef.current = true;
    wantsPlaybackRef.current = true;
    setPlayerError('');
    setIsLoading(true);
    if (playerReadyRef.current && playerRef.current) {
      if (resume) playerRef.current.playVideo();
      else playerRef.current.loadVideoById(track.youtubeVideoId);
    } else if (playerEnabled && playerError) {
      setPlayerAttempt((attempt) => attempt + 1);
    } else {
      setPlayerEnabled(true);
    }
    if (sync) broadcast({ trackId: track.id, isPlaying: true, volume, isMuted });
  };

  const togglePlay = () => {
    if (isPlaying || isLoading) {
      wantsPlaybackRef.current = false;
      if (playerReadyRef.current) playerRef.current?.pauseVideo();
      setIsLoading(false);
      broadcast({ trackId: currentTrack.id, isPlaying: false, volume, isMuted });
    } else {
      startTrack(currentTrack, true);
    }
  };

  const toggleMute = () => {
    const muted = !isMuted;
    setIsMuted(muted);
    if (playerReadyRef.current && playerRef.current) {
      if (muted) playerRef.current.mute();
      else playerRef.current.unMute();
    }
    broadcast({ trackId: currentTrack.id, isPlaying, volume, isMuted: muted });
  };
  const changeVolume = (nextVolume: number) => {
    setVolume(nextVolume);
    if (nextVolume > 0 && isMuted) setIsMuted(false);
    if (playerReadyRef.current && playerRef.current) {
      playerRef.current.setVolume(nextVolume);
      if (nextVolume === 0) playerRef.current.mute();
      else playerRef.current.unMute();
    }
    broadcast({ trackId: currentTrack.id, isPlaying, volume: nextVolume, isMuted: nextVolume === 0 });
  };

  const playNextTrack = () => {
    const nextIndex = (currentTrackIndex + 1) % tracks.length;
    setCurrentTrackIndex(nextIndex);
    startTrack(tracks[nextIndex]);
  };

  const selectTrack = (track: MusicTrack) => {
    const existingIndex = tracks.findIndex(item => item.id === track.id);
    const index = existingIndex >= 0 ? existingIndex : tracks.length;
    if (existingIndex < 0) setTracks(previous => [...previous, track]);
    setCurrentTrackIndex(index);
    startTrack(track);
    setIsMenuOpen(false);
  };


  const filteredTracks = tracks.filter(track =>
    `${track.title} ${track.artist} ${track.category}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const searchYouTube = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    if (query.length < 2) return;
    setIsSearching(true);
    setSearchError('');
    try {
      const response = await fetch('/api/music/search?q=' + encodeURIComponent(query));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed.');
      setSearchResults(Array.isArray(data.tracks) ? data.tracks : []);
    } catch (error) {
      setSearchError((error as Error).message);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };
  const addYouTubeLink = (event: React.FormEvent) => {
    event.preventDefault();
    const videoId = extractYouTubeVideoId(customUrl);
    if (!videoId) {
      setUrlError('Enter a valid YouTube link or video ID.');
      return;
    }
    const track: MusicTrack = {
      id: `custom-${Date.now()}`,
      title: 'Custom YouTube track',
      artist: 'YouTube',
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      youtubeVideoId: videoId,
      category: 'custom',
    };
    setTracks(previous => [track, ...previous]);
    setCurrentTrackIndex(0);
    startTrack(track);
    setCustomUrl('');
    setUrlError('');
    setIsMenuOpen(false);
  };

  return (
    <div className="relative flex items-center" ref={menuRef}>
      {/* Keep the same player mounted when paused or muted. Native controls
          also let the user start playback when the browser blocks autoplay. */}
      {playerEnabled && (
        <section aria-label="Study music player" className={`relative w-full max-w-[320px] border shadow-sm ${
          isDarkMode ? 'bg-[#181716] border-stone-700 text-stone-200' : 'bg-white border-stone-300 text-stone-800'
        }`}>
          <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-mono">
            <button aria-label="Close music player" className="float-right p-1" onClick={() => { wantsPlaybackRef.current = false; setPlayerEnabled(false); setIsPlaying(false); setIsLoading(false); }}>×</button>
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-expanded={isMenuOpen}
              aria-controls="music-tracks-dropdown"
              className="min-w-0 flex-1 truncate text-left font-semibold hover:text-[#991B1B] dark:hover:text-[#F87171]"
            >
              {currentTrack.title}
            </button>
            <span role="status" className="hidden shrink-0 text-[10px] text-stone-500 sm:inline">
              {playerError || (isLoading ? 'Loading music…' : isPlaying ? 'Playing' : 'Paused — press Play to listen')}
            </span>
            <button type="button" onClick={togglePlay} aria-label={isPlaying || isLoading ? 'Pause Study Music' : 'Play Study Music'} className="shrink-0 p-1">
              {isLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            </button>
            <label className="flex w-20 shrink-0 items-center gap-1.5">
              <Volume2 className="h-3.5 w-3.5 shrink-0" />
              <input
                type="range"
                min="0"
                max="100"
                value={isMuted ? 0 : volume}
                onChange={(event) => changeVolume(Number(event.target.value))}
                aria-label="Music volume"
                className="w-full accent-[#991B1B]"
              />
              <span className="w-7 text-right text-[10px]">{isMuted ? 0 : volume}%</span>
            </label>
          </div>
          <div ref={playerHostRef} className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none [&_iframe]:h-px [&_iframe]:w-px" />
        </section>
      )}

      {/* Sleek Top Music Bar HUD */}
      <div
        id="top-music-bar"
        className={`${playerEnabled ? 'hidden' : 'flex'} items-center space-x-2 px-2.5 py-1 border text-xs transition-colors ${
          isDarkMode
            ? 'bg-[#181716] border-stone-800 text-stone-200'
            : 'bg-stone-50 border-stone-300 text-stone-800'
        }`}
      >
        {/* Animated Equalizer Wave / Music Note */}
        <div className="flex items-center space-x-1 shrink-0">
          {isPlaying ? (
            <div className="flex items-end space-x-0.5 h-3.5 px-0.5" title="Audio playing">
              <span className="w-0.5 bg-[#991B1B] dark:bg-[#F87171] h-3.5 animate-[pulse_0.6s_ease-in-out_infinite]" />
              <span className="w-0.5 bg-[#991B1B] dark:bg-[#F87171] h-2 animate-[pulse_0.9s_ease-in-out_infinite]" />
              <span className="w-0.5 bg-[#991B1B] dark:bg-[#F87171] h-3 animate-[pulse_0.75s_ease-in-out_infinite]" />
            </div>
          ) : (
            <Music className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          )}
        </div>

        {/* Play / Pause Toggle Button */}
        <button
          id="music-play-toggle-btn"
          type="button"
          onClick={togglePlay}
          title={isPlaying || isLoading ? 'Pause Study Music' : 'Play Study Music'}
          aria-label={isPlaying || isLoading ? 'Pause Study Music' : 'Play Study Music'}
          className="p-1 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-[#991B1B] dark:hover:text-[#F87171] transition-colors cursor-pointer shrink-0"
        >
          {isLoading ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
        </button>

        {/* Skip Next Button */}
        <button
          id="music-skip-btn"
          type="button"
          onClick={playNextTrack}
          title="Skip to next track"
          aria-label="Skip to next track"
          className="p-1 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-[#991B1B] dark:hover:text-[#F87171] transition-colors cursor-pointer shrink-0"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        {/* Track Title & Artist (Truncated) */}
        <button
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          aria-expanded={isMenuOpen}
          aria-controls="music-tracks-dropdown"
          className="text-left flex items-center space-x-1.5 cursor-pointer max-w-[96px] sm:max-w-[190px] md:max-w-[240px] truncate hover:text-[#991B1B] dark:hover:text-[#F87171] transition-colors"
          title={`${currentTrack.title} — ${currentTrack.artist} (Click to switch stations)`}
        >
          <span className="font-medium truncate text-xs">
            {currentTrack.title}
          </span>
          <ChevronDown className="w-3 h-3 text-stone-400 shrink-0" />
        </button>

        {/* Volume / Mute Button */}
        <button
          id="music-mute-btn"
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          aria-pressed={isMuted}
          className="p-1 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors cursor-pointer shrink-0"
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-500" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Channel / Playlist Selection Dropdown Menu */}
      {isMenuOpen && (
        <div
          id="music-tracks-dropdown"
          className={`absolute top-full left-0 sm:left-auto sm:right-0 mt-1.5 w-[min(288px,calc(100vw-1rem))] max-h-80 overflow-y-auto border shadow-lg z-50 p-1.5 text-xs font-mono transition-colors ${
            isDarkMode
              ? 'bg-[#181716] border-stone-700 text-stone-200'
              : 'bg-white border-stone-300 text-stone-800'
          }`}
        >
          <div className="px-2 py-1 border-b border-stone-200 dark:border-stone-800 font-bold uppercase tracking-wider text-[10px] text-stone-400 flex items-center justify-between">
            <span>Study Soundtracks</span>
            <span className="text-[10px] text-[#991B1B] dark:text-[#F87171]">{tracks.length} Channels</span>
          </div>
          <form onSubmit={searchYouTube} className="p-2 border-b border-stone-200 dark:border-stone-800">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search YouTube music"
              placeholder="Search YouTube music..."
              className={`w-full px-2 py-1.5 text-xs rounded border transition-colors ${
                isDarkMode 
                  ? 'bg-stone-800 border-stone-700 text-stone-200 placeholder-stone-500 focus:border-[#F87171]' 
                  : 'bg-stone-100 border-stone-300 text-stone-800 placeholder-stone-400 focus:border-[#991B1B]'
              } focus:outline-none`}
            />
            <button type="submit" disabled={isSearching || search.trim().length < 2} className="mt-2 w-full bg-[#991B1B] px-2 py-1.5 text-white disabled:opacity-50">
              {isSearching ? 'Searching YouTube…' : 'Search YouTube'}
            </button>
            {searchError && <p role="alert" className="mt-1 text-red-600 dark:text-red-400">{searchError}</p>}
            </form>
          <form onSubmit={addYouTubeLink} className="border-b border-stone-200 p-2 dark:border-stone-800">
            <input
              type="text"
              value={customUrl}
              onChange={(event) => { setCustomUrl(event.target.value); setUrlError(''); }}
              aria-label="Add YouTube link"
              placeholder="Or paste a YouTube link..."
              className={`w-full rounded border px-2 py-1.5 text-xs transition-colors ${
                isDarkMode
                  ? 'border-stone-700 bg-stone-800 text-stone-200 placeholder-stone-500 focus:border-[#F87171]'
                  : 'border-stone-300 bg-stone-100 text-stone-800 placeholder-stone-400 focus:border-[#991B1B]'
              } focus:outline-none`}
            />
            <button type="submit" disabled={!customUrl.trim()} className="mt-2 w-full border border-[#991B1B] px-2 py-1.5 text-[#991B1B] hover:bg-[#991B1B] hover:text-white disabled:opacity-50 dark:text-[#F87171]">
              Add YouTube link
            </button>
            {urlError && <p role="alert" className="mt-1 text-red-600 dark:text-red-400">{urlError}</p>}
          </form>


          <div className="py-1 space-y-0.5">
            {[...searchResults, ...filteredTracks].filter((track, index, all) => all.findIndex(item => item.id === track.id) === index).map((t) => {
              const idx = tracks.findIndex(item => item.id === t.id);
              const isSelected = idx === currentTrackIndex;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTrack(t)}
                  className={`w-full text-left px-2 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#991B1B] text-white'
                      : isDarkMode
                      ? 'hover:bg-stone-800 text-stone-300'
                      : 'hover:bg-stone-100 text-stone-700'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold truncate text-[11px]">{t.title}</div>
                    <div
                      className={`text-[10px] truncate ${
                        isSelected ? 'text-red-200' : 'text-stone-500 dark:text-stone-400'
                      }`}
                    >
                      {t.artist} • {t.category.toUpperCase()}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-bold shrink-0 uppercase tracking-wide">
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
