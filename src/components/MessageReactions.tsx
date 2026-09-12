import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smile, X } from 'lucide-react';
import { MESSAGE_REACTIONS } from '../data/reactions';

export function MessageReactions({ children, reactions = {}, sessionId, onReact, actions, onLongPress, align = 'start', showMobileReaction = false }: {
  children: React.ReactNode;
  reactions?: Record<string, string>;
  sessionId: string;
  onReact: (emoji: string | null) => Promise<void>;
  actions?: React.ReactNode;
  onLongPress?: () => void;
  align?: 'start' | 'end';
  showMobileReaction?: boolean;
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clearPress = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setIsHolding(false); };
  const open = (longPress = false) => {
    if (longPress && onLongPress) {
      onLongPress();
      return;
    }
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
    <div className={`relative flex min-w-0 w-fit max-w-full flex-col ${align === 'end' ? 'self-end items-end' : 'self-start items-start'}`}>
      <div ref={anchor} className={`reaction-message-anchor relative min-w-0 w-fit max-w-full [&>*]:[-webkit-touch-callout:none] max-sm:select-none ${isHolding ? 'is-holding' : ''}`}
      onTouchStart={event => {
        clearPress();
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        start.current = { x: touch.clientX, y: touch.clientY };
        setIsHolding(true);
        timer.current = setTimeout(() => open(true), 450);
      }}
      onTouchMove={event => {
        const touch = event.touches[0];
        if (!touch || !start.current || Math.hypot(touch.clientX - start.current.x, touch.clientY - start.current.y) > 10) clearPress();
      }}
      onTouchEnd={clearPress} onTouchCancel={clearPress}
      onContextMenu={event => { event.preventDefault(); clearPress(); open(true); }}
      >
        {children}
        {MESSAGE_REACTIONS.some(({ emoji }) => Object.values(reactions).includes(emoji)) && (
          <div className={`pointer-events-none relative z-10 -mt-1.5 flex flex-wrap gap-1 px-2 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
          {MESSAGE_REACTIONS.map(({ emoji, label }) => {
            const count = Object.values(reactions).filter(value => value === emoji).length;
            return count > 0 && (
              <button
                key={emoji}
                type="button"
                aria-label={`${label} reaction, ${count}`}
                aria-pressed={reactions[sessionId] === emoji}
                onClick={() => void choose(emoji)}
                className="pointer-events-auto inline-flex min-h-6 items-center gap-0.5 rounded-full border border-stone-300 bg-white px-1.5 text-xs shadow-sm dark:border-stone-700 dark:bg-stone-900"
              >
                {emoji} {count > 1 && <span className="text-[10px] text-stone-500 dark:text-stone-400">{count}</span>}
              </button>
            );
          })}
          </div>
        )}
      </div>
      <div className={`hidden w-max flex-nowrap items-center gap-0.5 overflow-hidden transition-opacity duration-150 sm:flex ${position ? 'max-h-8 opacity-100' : 'max-h-0 opacity-0 group-hover:max-h-8 group-hover:opacity-100 group-focus-within:max-h-8 group-focus-within:opacity-100'}`}>
      <button type="button" aria-label="React to message" aria-haspopup="dialog" aria-expanded={Boolean(position)} disabled={pending} onClick={() => open()}
        className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[10px] text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
        <Smile className="h-3.5 w-3.5" /> React
      </button>
      {actions}
      </div>
      {showMobileReaction && (
        <button
          type="button"
          aria-label="React to message"
          aria-haspopup="dialog"
          aria-expanded={Boolean(position)}
          disabled={pending}
          onClick={() => open()}
          className="mt-0.5 flex min-h-6 items-center gap-1 rounded-full px-1.5 text-[10px] text-stone-500 sm:hidden dark:text-stone-400"
        >
          <Smile className="h-3 w-3" /> React
        </button>
      )}
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
