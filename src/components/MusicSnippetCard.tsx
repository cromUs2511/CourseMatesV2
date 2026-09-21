import { useState } from 'react';
import { ExternalLink, Pause, Play } from 'lucide-react';
import type { MusicSnippet } from '../data/musicSnippet';
import { YouTubeSnippetPlayer } from './YouTubeSnippetPlayer';

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function MusicSnippetCard({ snippet, active, playing, onToggle, onPlayingChange }: {
  snippet: MusicSnippet;
  active: boolean;
  playing: boolean;
  onToggle: () => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const [error, setError] = useState('');
  const url = `https://www.youtube.com/watch?v=${snippet.youtubeId}&t=${snippet.startTime}s`;
  return <div role="group" aria-label={`Music snippet: ${snippet.title} by ${snippet.artist}`} className="music-snippet-card w-[min(72vw,18rem)] max-w-full rounded-xl border border-white/10 bg-[#19191e] p-3 text-stone-100 shadow-lg">
    <div className="flex min-w-0 items-center gap-3">
      <div className={`music-snippet-art relative h-20 w-20 shrink-0 ${playing ? 'is-playing' : ''}`}>
        <div className="music-snippet-disc absolute left-5 top-1 h-[72px] w-[72px] rounded-full border border-stone-600 bg-[repeating-radial-gradient(circle_at_center,#1b1b1f_0_3px,#303036_4px_5px,#17171b_6px_8px)] shadow-lg">
          <span className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-stone-900 bg-rose-700" />
        </div>
        <img src={snippet.artworkUrl} alt={`${snippet.title} artwork`} className="relative z-10 h-20 w-20 rounded-md object-cover shadow-md" loading="lazy" />
      </div>
      <div className="relative z-20 min-w-0 flex-1">
        <p className="truncate text-xs font-bold" title={snippet.title}>{snippet.title}</p>
        <p className="truncate text-[11px] text-stone-400" title={snippet.artist}>{snippet.artist}</p>
        <p className="mt-1 text-[10px] text-rose-300">{formatTime(snippet.startTime)}–{formatTime(snippet.startTime + snippet.duration)}</p>
        <button type="button" onClick={() => { setError(''); onToggle(); }} aria-label={playing ? 'Pause music snippet' : 'Play music snippet'}
          className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-full bg-rose-700 px-2.5 text-[10px] font-semibold text-white hover:bg-rose-600">
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}{playing ? 'Pause' : 'Play snippet'}
        </button>
      </div>
    </div>
    {active && <div className="mt-3"><YouTubeSnippetPlayer youtubeId={snippet.youtubeId} startTime={snippet.startTime} duration={snippet.duration} playing={playing} onPlayingChange={onPlayingChange} onError={message => { setError(message); onPlayingChange(false); }} /></div>}
    {error && <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>}
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] text-stone-400 underline hover:text-white">Open on YouTube <ExternalLink className="h-3 w-3" /></a>
  </div>;
}
