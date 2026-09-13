import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';

export function PhotoDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    document.documentElement.classList.add('media-dialog-open');
    element.showModal();
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    element.addEventListener('cancel', cancel);
    return () => {
      element.removeEventListener('cancel', cancel);
      element.close();
      document.documentElement.classList.remove('media-dialog-open');
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-label={title} onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-stone-300 bg-[#faf8f5] p-0 text-stone-900 shadow-2xl backdrop:bg-black/65 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100">
    <div className="p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close photo dialog" className="flex h-9 w-9 shrink-0 items-center justify-center border border-stone-300 dark:border-stone-700"><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  </dialog>;
}

export function ZoomablePhoto({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const updateScale = (next: number) => setScale(Math.max(1, Math.min(4, Math.round(next * 4) / 4)));
  return <div className="space-y-3">
    <div className="flex items-center justify-center gap-2" aria-label="Photo zoom controls">
      <button type="button" onClick={() => updateScale(scale - 0.5)} disabled={scale <= 1} aria-label="Zoom out" className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 disabled:opacity-40 dark:border-stone-700"><Minus className="h-4 w-4" /></button>
      <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
      <button type="button" onClick={() => updateScale(scale + 0.5)} disabled={scale >= 4} aria-label="Zoom in" className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 disabled:opacity-40 dark:border-stone-700"><Plus className="h-4 w-4" /></button>
      <button type="button" onClick={() => setScale(1)} disabled={scale === 1} aria-label="Reset zoom" className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 disabled:opacity-40 dark:border-stone-700"><RotateCcw className="h-4 w-4" /></button>
    </div>
    <div className="flex max-h-[68dvh] min-h-48 items-center justify-center overflow-auto rounded-lg bg-black/5 dark:bg-black/20"
      onWheel={event => { if (!event.ctrlKey) return; event.preventDefault(); updateScale(scale - event.deltaY * 0.002); }}>
      <img src={src} alt={alt} draggable={false} onDoubleClick={() => updateScale(scale === 1 ? 2 : 1)}
        className="max-h-[66dvh] max-w-full select-none object-contain [transform-origin:center] [will-change:transform]"
        style={{ transform: `translateZ(0) scale(${scale})` }} />
    </div>
  </div>;
}
