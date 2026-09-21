import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { toggleThemeWithReveal } from '../utils/themeTransition';

interface ThemeToggleProps {
  isDarkMode: boolean;
  onToggle: () => void;
  className?: string;
  id?: string;
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ isDarkMode, onToggle, className = '', id, compact = false }) => (
  <button
    type="button"
    id={id}
    onClick={event => void toggleThemeWithReveal(event.currentTarget, onToggle)}
    aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    aria-pressed={isDarkMode}
    title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    className={`theme-toggle group relative inline-flex shrink-0 items-center rounded-full border p-1 transition-all duration-300 ease-out ${
      compact ? 'h-7 w-12' : 'h-9 w-[68px]'
    } ${
      isDarkMode
        ? 'border-stone-800 bg-[#2a2a2a] text-white'
        : 'border-stone-300 bg-white text-stone-500'
    } ${className}`}
    data-state={isDarkMode ? 'dark' : 'light'}
  >
    <span
      aria-hidden="true"
      className={`absolute left-1 rounded-full transition-transform duration-300 ease-out animate-toggle-icon ${
        compact ? 'h-5 w-5' : 'h-7 w-7'
      } ${isDarkMode ? `bg-[#141312] ${compact ? 'translate-x-5' : 'translate-x-8'}` : 'translate-x-0 bg-white'}`}
    />
    <span aria-hidden="true" className={`absolute flex items-center justify-center ${isDarkMode ? 'left-2.5' : 'right-2.5'}`}>
      {isDarkMode ? <Moon className={compact ? 'h-3 w-3' : 'h-4 w-4'} fill="currentColor" /> : <Sun className={compact ? 'h-3 w-3' : 'h-4 w-4'} />}
    </span>
  </button>
);
