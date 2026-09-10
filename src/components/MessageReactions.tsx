import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smile, X } from 'lucide-react';
import { MESSAGE_REACTIONS } from '../data/reactions';

export function MessageReactions({ children, reactions = {}, sessionId, onReact }: {
  children: React.ReactNode;
  reactions?: Record<string, string>;
  sessionId: string;
  onReact: (emoji: string | null) => Promise<void>;
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clearPress = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setIsHolding(false); };
  const open = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - 304)), top: Math.max(8, Math.min(box.top - 100, window.innerHeight - 108)) });
  };
  useEffect(() => () => clearPress(), []);
  useEffect(() => {
    if (!position) return;
    const previous = document.activeElement as HTMLElement | null;
    menu.current?.querySelector('button')?.focus();
    const close = () => setPosition(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const buttons = Array.from(menu.current?.querySelectorAll('button') || []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      previous?.focus({ preventScroll: true });
    };
  }, [position]);
  const choose = async (emoji: string) => {
    if (pending) return;
    setPosition(null);
    setPending(true);
    try { await onReact(reactions[sessionId] === emoji ? null : emoji); }
    finally { setPending(false); }
  };
  return <>
    <div ref={anchor} className={`reaction-message-anchor [&>*]:[-webkit-touch-callout:none] max-sm:select-none ${isHolding ? 'is-holding' : ''}`}
      onTouchStart={event => {
        clearPress();
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        start.current = { x: touch.clientX, y: touch.clientY };
        setIsHolding(true);
        timer.current = setTimeout(open, 450);
      }}
      onTouchMove={event => {
        const touch = event.touches[0];
        if (!touch || !start.current || Math.hypot(touch.clientX - start.current.x, touch.clientY - start.current.y) > 10) clearPress();
      }}
      onTouchEnd={clearPress} onTouchCancel={clearPress}
      onContextMenu={event => { event.preventDefault(); clearPress(); open(); }}
    >{children}</div>
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {MESSAGE_REACTIONS.map(({ emoji, label }) => {
        const count = Object.values(reactions).filter(value => value === emoji).length;
        return count > 0 && <button key={emoji} type="button" disabled={pending} aria-label={`${label} reaction, ${count}`} aria-pressed={reactions[sessionId] === emoji}
          onClick={() => void choose(emoji)}
          className={`min-h-8 rounded-full border px-2 text-sm ${reactions[sessionId] === emoji ? 'border-red-400 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100' : 'border-stone-300 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200'}`}>
          {emoji} <span className="text-xs">{count}</span>
        </button>;
      })}
      <button type="button" aria-label="React to message" aria-haspopup="dialog" aria-expanded={Boolean(position)} disabled={pending} onClick={open}
        className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[10px] text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
        <Smile className="h-3.5 w-3.5" /> React
      </button>
    </div>
    {position && createPortal(<div className="reaction-picker-layer fixed inset-0 z-[100]" onTouchStart={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}>
      <div className="reaction-picker-backdrop absolute inset-0 bg-black/10" onClick={() => setPosition(null)} />
      <div ref={menu} role="dialog" aria-modal="true" aria-label="React to message" style={position}
        className="reaction-picker fixed w-[296px] max-w-[calc(100vw-16px)] rounded-2xl border border-stone-200 bg-[#FAF8F5] p-2 text-stone-800 shadow-xl dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
        <div className="mb-1 flex items-center justify-between px-2 text-xs font-medium">React to message<button type="button" aria-label="Close reactions" className="p-1" onClick={() => setPosition(null)}><X className="h-4 w-4" /></button></div>
        <div className="flex justify-between">{MESSAGE_REACTIONS.map(({ emoji, label }, index) => <button key={emoji} type="button" aria-label={label} aria-pressed={reactions[sessionId] === emoji} onClick={() => void choose(emoji)} style={{ '--reaction-delay': `${index * 32}ms` } as React.CSSProperties}
          className="reaction-picker-option flex h-11 flex-1 items-center justify-center rounded-full text-2xl transition-transform hover:scale-110 hover:bg-stone-200 focus-visible:outline-2 focus-visible:outline-red-500 aria-pressed:bg-red-100 dark:hover:bg-stone-700 dark:aria-pressed:bg-red-950">{emoji}</button>)}</div>
      </div>
    </div>, document.fullscreenElement || document.body)}
  </>;
}
