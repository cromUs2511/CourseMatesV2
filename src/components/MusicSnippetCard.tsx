import { useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
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
  return <div role="group" aria-label={`Music snippet: ${snippet.title} by ${snippet.artist}`} className="music-snippet-card w-[min(72vw,18rem)] max-w-full overflow-hidden rounded-2xl border border-white/10 bg-[#19191e] p-3 text-stone-100 shadow-lg">
    <div className="flex min-w-0 items-center gap-3">
      <div className={`music-snippet-spectrum flex h-16 w-20 shrink-0 items-center justify-center gap-[3px] rounded-xl bg-gradient-to-br from-rose-950 via-stone-950 to-violet-950 px-2 shadow-inner ${playing ? 'is-playing' : ''}`} aria-hidden="true">
        {Array.from({ length: 13 }, (_, index) => <span key={index} style={{ '--spectrum-delay': `${index * -70}ms`, '--spectrum-height': `${28 + ((index * 17) % 62)}%` } as CSSProperties} />)}
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
    {active && <YouTubeSnippetPlayer hidden youtubeId={snippet.youtubeId} startTime={snippet.startTime} duration={snippet.duration} playing={playing} onPlayingChange={onPlayingChange} onError={message => { setError(message); onPlayingChange(false); }} />}
    {error && <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>}
  </div>;
}
