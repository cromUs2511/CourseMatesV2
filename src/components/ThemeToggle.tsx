import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { toggleThemeWithReveal } from '../utils/themeTransition';

interface ThemeToggleProps {
  isDarkMode: boolean;
  onToggle: () => void;
  className?: string;
  id?: string;
  compact?: boolean;
  iconOnly?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ isDarkMode, onToggle, className = '', id, compact = false, iconOnly = false }) => (
  <button
    type="button"
    id={id}
    onClick={event => void toggleThemeWithReveal(event.currentTarget, onToggle)}
    aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    aria-pressed={isDarkMode}
    title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    className={`group relative inline-flex shrink-0 items-center border transition-all duration-300 ease-out ${
      iconOnly
        ? 'h-10 w-10 justify-center rounded-xl'
        : 'rounded-full p-1'
    } ${
      !iconOnly && (compact ? 'h-7 w-12' : 'h-8 w-[58px]')
    } ${
      isDarkMode
        ? 'border-stone-700 bg-stone-900 text-amber-300'
        : 'border-stone-300 bg-stone-200 text-amber-500'
    } ${className}`}
    data-state={isDarkMode ? 'dark' : 'light'}
  >
    {iconOnly ? (
      isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
    ) : (
      <>
        <span
          className={`absolute left-1 flex items-center justify-center rounded-full shadow-md transition-all duration-300 ease-out animate-toggle-icon ${
            compact ? 'h-5 w-5' : 'h-6 w-6'
          } ${
            isDarkMode
              ? compact
                ? 'translate-x-[18px] bg-stone-100 text-stone-800'
                : 'translate-x-[24px] bg-stone-900 text-amber-300'
              : 'translate-x-0 bg-white text-amber-500'
          }`}
        >
          {isDarkMode ? <Sun className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : <Moon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
        </span>
        <span className={`ml-auto mr-1 transition-opacity duration-300 ${isDarkMode ? 'text-amber-300 opacity-100' : 'text-stone-500 opacity-70'}`}>
          {isDarkMode ? <Moon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : <Sun className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
        </span>
      </>
    )}
  </button>
);
