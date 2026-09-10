import React, { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';

export interface ChatTheme {
  id: string;
  label: string;
  lightBackground: string;
  darkBackground: string;
  accent: string;
  accentHover: string;
  swatch: string;
}

export const CHAT_THEMES: ChatTheme[] = [
  { id: 'mapua', label: 'Mapua red', lightBackground: '#FAF8F5', darkBackground: '#141312', accent: '#991B1B', accentHover: '#7F1D1D', swatch: '#991B1B' },
  { id: 'ocean', label: 'Ocean blue', lightBackground: '#F2F8FC', darkBackground: '#101A22', accent: '#126782', accentHover: '#0E5268', swatch: '#168AAD' },
  { id: 'forest', label: 'Forest green', lightBackground: '#F3F8F1', darkBackground: '#142018', accent: '#2F6B3D', accentHover: '#245631', swatch: '#4F8A5B' },
  { id: 'violet', label: 'Violet dusk', lightBackground: '#F7F3FB', darkBackground: '#1C1724', accent: '#704B9B', accentHover: '#5B3D80', swatch: '#8B5FBF' },
  { id: 'sunset', label: 'Sunset orange', lightBackground: '#FFF7ED', darkBackground: '#241711', accent: '#C2410C', accentHover: '#9A3412', swatch: '#EA580C' },
  { id: 'rose', label: 'Rose pink', lightBackground: '#FFF1F2', darkBackground: '#241419', accent: '#BE185D', accentHover: '#9D174D', swatch: '#DB2777' },
  { id: 'amber', label: 'Amber glow', lightBackground: '#FFFBEB', darkBackground: '#211B0D', accent: '#A16207', accentHover: '#854D0E', swatch: '#D97706' },
  { id: 'slate', label: 'Slate graphite', lightBackground: '#F1F5F9', darkBackground: '#111827', accent: '#475569', accentHover: '#334155', swatch: '#64748B' },
];

interface ChatThemeMenuProps {
  theme: ChatTheme;
  onChange: (theme: ChatTheme) => void;
  isDarkMode: boolean;
}

export const ChatThemeMenu: React.FC<ChatThemeMenuProps> = ({ theme, onChange, isDarkMode }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="contents min-[960px]:relative min-[960px]:block">
      <button
        type="button"
        aria-label="Choose chat color theme"
        aria-expanded={open}
        title={`Chat theme: ${theme.label}`}
        onClick={() => setOpen(value => !value)}
        className="chat-theme-outline flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 text-stone-700 transition-colors hover:border-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Chat color themes"
          className={`order-last w-full rounded-xl border p-2 min-[960px]:absolute min-[960px]:right-0 min-[960px]:top-11 min-[960px]:z-30 min-[960px]:max-h-[calc(100dvh-80px)] min-[960px]:w-52 min-[960px]:overflow-y-auto min-[960px]:shadow-xl ${
            isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-200' : 'border-stone-300 bg-white text-stone-800'
          }`}
        >
          <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">Chat colors</p>
          {CHAT_THEMES.map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={theme.id === option.id}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                theme.id === option.id ? 'bg-stone-500/15 font-semibold' : 'hover:bg-stone-500/10'
              }`}
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full border border-black/10"
                style={{ background: `linear-gradient(135deg, ${option.swatch} 50%, ${option.lightBackground} 50%)` }}
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
