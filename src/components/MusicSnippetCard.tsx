import { useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import type { MusicSnippet } from '../data/musicSnippet';
import { YouTubeSnippetPlayer } from './YouTubeSnippetPlayer';

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function MusicSnippetCard({
  snippet,
  active,
  playing,
  onToggle,
  onPlayingChange,
}: {
  snippet: MusicSnippet;
  active: boolean;
  playing: boolean;
  onToggle: () => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const [error, setError] = useState('');
  return (
    <div
      role="group"
      aria-label={`Music snippet: ${snippet.title} by ${snippet.artist}`}
      className="music-snippet-card w-[min(64vw,15rem)] max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/25 p-2.5 text-stone-100"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            setError('');
            onToggle();
          }}
          aria-label={playing ? 'Pause music snippet' : 'Play music snippet'}
          className="chat-theme-accent-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
        >
          {playing ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </button>
        <div
          className={`music-snippet-spectrum flex h-8 w-12 shrink-0 items-center justify-center gap-[2px] ${playing ? 'is-playing' : ''}`}
          aria-hidden="true"
        >
          {Array.from({ length: 9 }, (_, index) => (
            <span
              key={index}
              style={
                {
                  '--spectrum-delay': `${index * -80}ms`,
                  '--spectrum-height': `${30 + ((index * 23) % 60)}%`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold" title={snippet.title}>
            {snippet.title}
          </p>
          <p className="truncate text-[11px] text-stone-400" title={snippet.artist}>
            {snippet.artist}
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-stone-400">
          {formatTime(snippet.duration)}
        </span>
      </div>
      {active && (
        <YouTubeSnippetPlayer
          hidden
          youtubeId={snippet.youtubeId}
          startTime={snippet.startTime}
          duration={snippet.duration}
          playing={playing}
          onPlayingChange={onPlayingChange}
          onError={(message) => {
            setError(message);
            onPlayingChange(false);
          }}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
