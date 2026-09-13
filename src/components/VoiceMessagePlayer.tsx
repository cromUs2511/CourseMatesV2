import React, { useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { ChatVoice } from '../data/chatVoice';

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const VoiceMessagePlayer = React.memo(function VoiceMessagePlayer({ voice, isMe }: { voice: ChatVoice; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const duration = Math.max(1, voice.duration);
  const progress = Math.min(1, currentTime / duration);
  const bars = useMemo(() => Array.from({ length: 34 }, (_, index) => {
    const code = voice.id.charCodeAt(index % Math.max(1, voice.id.length)) || 17;
    return 7 + ((code * (index + 5) * 13) % 22);
  }), [voice.id]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch { setPlaying(false); }
  };
  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration;
    audio.currentTime = next;
    setCurrentTime(next);
  };
  const seekWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(duration, audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)));
    audio.currentTime = next;
    setCurrentTime(next);
  };

  return <div className={`flex min-w-[230px] max-w-[310px] items-center gap-2.5 rounded-2xl px-3 py-2.5 ${isMe ? 'bg-black/15 text-white' : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-100'}`}>
    <audio ref={audioRef} src={voice.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setCurrentTime(0); }} />
    <button type="button" onClick={() => void toggle()} aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isMe ? 'bg-white text-stone-900' : 'chat-theme-accent-button text-white'}`}>
      {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
    </button>
    <div className="min-w-0 flex-1">
      <div role="slider" tabIndex={0} aria-label="Voice message position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.floor(currentTime)}
        onClick={seek} onKeyDown={seekWithKeyboard} className="flex h-9 cursor-pointer items-center gap-[2px] rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        {bars.map((height, index) => <span key={index} aria-hidden="true" className={`w-[2px] shrink-0 rounded-full transition-colors ${index / bars.length <= progress ? (isMe ? 'bg-white' : 'chat-theme-accent-button') : (isMe ? 'bg-white/45' : 'bg-stone-300 dark:bg-stone-600')}`}
          style={{ height }} />)}
      </div>
    </div>
    <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${isMe ? 'text-white/90' : 'text-stone-500 dark:text-stone-300'}`}>{formatTime(playing || currentTime ? currentTime : duration)}</span>
  </div>;
});
