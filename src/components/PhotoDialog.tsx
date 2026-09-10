import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function PhotoDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    element.addEventListener('cancel', cancel);
    return () => {
      element.removeEventListener('cancel', cancel);
      element.close();
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
