import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music2, Pause, Play, Search, Send, X } from 'lucide-react';
import type { MusicTrack } from '../types';
import type { MusicSnippet } from '../data/musicSnippet';
import { DEFAULT_MUSIC_DIRECTORY, parseTrackDuration } from '../data/musicDirectory';
import { apiRequest } from '../utils/api';
import { YouTubeSnippetPlayer } from './YouTubeSnippetPlayer';

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const isSeekable = (track: MusicTrack) => parseTrackDuration(track.duration) !== null;

export function MusicSnippetPicker({ token, onClose, onSend }: {
  token: string;
  onClose: () => void;
  onSend: (snippet: MusicSnippet) => Promise<void>;
}) {
  const [tracks, setTracks] = useState<MusicTrack[]>(DEFAULT_MUSIC_DIRECTORY.filter(isSeekable));
  const [results, setResults] = useState<MusicTrack[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MusicTrack | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [duration, setDuration] = useState(15);
  const [caption, setCaption] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const total = parseTrackDuration(selected?.duration) || 0;
  const maxStart = Math.max(0, total - duration);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/music/directory', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Catalog unavailable.')))
      .then(data => {
        if (!controller.signal.aborted && Array.isArray(data.tracks)) {
          setTracks(data.tracks.filter((track: MusicTrack) => track?.youtubeVideoId && isSeekable(track)));
        }
      }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [onClose]);

  const waveform = useMemo(() => Array.from({ length: 72 }, (_, index) => {
    const seed = selected?.youtubeVideoId.charCodeAt(index % 11) || 31;
    return 18 + Math.round(Math.abs(Math.sin(index * 1.73 + seed)) * 57);
  }), [selected?.youtubeVideoId]);
  const selectTrack = (track: MusicTrack) => {
    setSelected(track);
    setStartTime(0);
    setDuration(15);
    setPreviewOpen(false);
    setPlaying(false);
    setError('');
  };
  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError('');
    try {
      const data = await apiRequest<{ tracks: MusicTrack[] }>('/api/music/search?q=' + encodeURIComponent(query.trim()), token);
      const seekable = data.tracks.filter(isSeekable);
      setResults(seekable);
      if (!seekable.length) setError('No seekable songs found. Try another search.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setSearching(false); }
  };
  const send = async () => {
    if (!selected || busy || total < duration) return;
    setBusy(true);
    setPlaying(false);
    setError('');
    try {
      await onSend({
        trackId: selected.id, title: selected.title, artist: selected.artist,
        artworkUrl: `https://img.youtube.com/vi/${selected.youtubeVideoId}/hqdefault.jpg`,
        youtubeId: selected.youtubeVideoId, startTime, duration, caption: caption.trim(),
      });
      onClose();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const visibleTracks = [...results, ...tracks].filter((track, index, all) => all.findIndex(item => item.youtubeVideoId === track.youtubeVideoId) === index);

  return createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6" role="presentation">
    <button type="button" aria-label="Close music snippet picker" onClick={onClose} className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
    <section role="dialog" aria-modal="true" aria-labelledby="music-snippet-title" className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-stone-700 bg-[#19191b] text-stone-100 shadow-2xl">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2"><Music2 className="h-4 w-4 text-rose-400" /><h2 id="music-snippet-title" className="text-sm font-bold">Send music snippet</h2></div>
        <button type="button" onClick={onClose} aria-label="Close music snippet picker" className="rounded-lg p-1.5 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </header>
      <div className="grid min-h-0 overflow-y-auto md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:overflow-hidden">
        <div className="min-h-0 border-b border-white/10 p-4 md:overflow-y-auto md:border-b-0 md:border-r md:p-5">
          <form onSubmit={search} className="flex gap-2">
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search songs" placeholder="Search songs on YouTube" className="min-w-0 flex-1 rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-xs outline-none focus:border-rose-400" />
            <button type="submit" aria-label="Search songs" disabled={searching} className="rounded-lg bg-rose-700 px-3 disabled:opacity-50"><Search className="h-4 w-4" /></button>
          </form>
          <p className="mt-2 text-[10px] text-stone-400">Choose a song with a fixed duration. Live streams cannot be trimmed.</p>
          <div className="mt-3 space-y-1.5" aria-label="Available songs">
            {visibleTracks.map(track => <button key={track.youtubeVideoId} type="button" onClick={() => selectTrack(track)} aria-label={`Select ${track.title} by ${track.artist}`} aria-pressed={selected?.youtubeVideoId === track.youtubeVideoId}
              className={`flex w-full items-center gap-2 rounded-xl border p-2 text-left ${selected?.youtubeVideoId === track.youtubeVideoId ? 'border-rose-500 bg-rose-500/15' : 'border-transparent hover:bg-white/10'}`}>
              <img src={track.thumbnail || `https://img.youtube.com/vi/${track.youtubeVideoId}/hqdefault.jpg`} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" loading="lazy" />
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{track.title}</span><span className="block truncate text-[10px] text-stone-400">{track.artist}</span></span>
              <span className="text-[10px] text-stone-400">{formatTime(parseTrackDuration(track.duration) || 0)}</span>
            </button>)}
          </div>
        </div>
        <div className="min-h-0 p-4 md:overflow-y-auto md:p-5">
          {selected ? <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img src={selected.thumbnail || `https://img.youtube.com/vi/${selected.youtubeVideoId}/hqdefault.jpg`} alt="" className="h-16 w-16 rounded-xl object-cover" />
              <div className="min-w-0"><p className="truncate text-sm font-bold">{selected.title}</p><p className="truncate text-xs text-stone-400">{selected.artist}</p></div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2 text-xs"><span className="font-semibold">Choose the moment</span><span className="text-rose-300">{formatTime(startTime)}–{formatTime(startTime + duration)}</span></div>
              <div className="relative flex h-20 items-center gap-px overflow-hidden rounded-xl bg-stone-900 px-2" aria-hidden="true">
                {waveform.map((height, index) => <span key={index} className="min-w-0 flex-1 rounded-full bg-stone-500/80" style={{ height: `${height}%` }} />)}
                <div className="pointer-events-none absolute inset-y-1 rounded-lg border-2 border-rose-400 bg-rose-400/20 shadow-[0_0_18px_rgba(251,113,133,0.25)]" style={{ left: `${(startTime / total) * 100}%`, width: `${(duration / total) * 100}%` }} />
              </div>
              <input type="range" aria-label="Snippet start" min={0} max={maxStart} step={1} value={startTime} onChange={event => { setStartTime(Number(event.target.value)); setPreviewOpen(false); setPlaying(false); }} className="snippet-range mt-2 w-full accent-rose-400" />
              <div className="flex justify-between text-[10px] text-stone-400"><span>0:00</span><span>{formatTime(total)}</span></div>
            </div>
            <label className="flex items-center justify-between gap-3 text-xs">Snippet length
              <select aria-label="Snippet length" value={duration} onChange={event => { const next = Number(event.target.value); setDuration(next); setStartTime(value => Math.min(value, Math.max(0, total - next))); setPreviewOpen(false); setPlaying(false); }} className="rounded-lg border border-stone-600 bg-stone-900 px-3 py-2">
                {[15, 20, 25, 30].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
              </select>
            </label>
            <label className="block text-xs">Add a note <span className="text-stone-500">(optional)</span>
              <textarea aria-label="Add a note" value={caption} maxLength={280} onChange={event => setCaption(event.target.value)} placeholder="Listening to this vibe right now…" rows={2} className="mt-1.5 w-full resize-none rounded-lg border border-stone-600 bg-stone-900 p-3 text-xs outline-none focus:border-rose-400" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { setPreviewOpen(true); setPlaying(value => !previewOpen || !value); }} aria-label={playing ? 'Pause snippet preview' : 'Preview snippet'} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-600 px-3 py-2 text-xs hover:bg-white/10">
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{playing ? 'Pause' : 'Preview snippet'}
              </button>
              <button type="button" onClick={() => void send()} disabled={busy || total < duration} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" />{busy ? 'Sending…' : 'Send snippet'}</button>
            </div>
            {previewOpen && <YouTubeSnippetPlayer youtubeId={selected.youtubeVideoId} startTime={startTime} duration={duration} playing={playing} onPlayingChange={setPlaying} onError={message => { setError(message); setPlaying(false); }} />}
          </div> : <div className="flex h-full min-h-44 flex-col items-center justify-center text-center text-stone-400"><Music2 className="mb-3 h-8 w-8" /><p className="text-sm">Choose a song to trim and preview.</p></div>}
          {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
        </div>
      </div>
    </section>
  </div>, document.fullscreenElement || document.body);
}
