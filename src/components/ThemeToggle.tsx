import React from 'react';
import { Moon, Sun } from 'lucide-react';

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
    onClick={onToggle}
    aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    className={`group relative inline-flex shrink-0 items-center rounded-full border p-1 transition-colors duration-300 ${
      compact ? 'h-7 w-12' : 'h-8 w-[58px]'
    } ${
      isDarkMode
        ? 'border-stone-700 bg-stone-900'
        : 'border-stone-300 bg-stone-200'
    } ${className}`}
  >
    <span className={`absolute left-1 flex items-center justify-center rounded-full shadow-md transition-transform duration-300 ease-out ${
      compact ? 'h-5 w-5' : 'h-6 w-6'
    } ${
      isDarkMode
        ? compact ? 'translate-x-[18px] bg-stone-100 text-stone-800' : 'translate-x-[24px] bg-stone-100 text-stone-800'
        : 'translate-x-0 bg-white text-amber-500'
    }`}>
      {isDarkMode ? <Sun className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : <Moon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
    </span>
    <span className={`ml-auto mr-1 transition-opacity duration-300 ${isDarkMode ? 'text-amber-300 opacity-100' : 'text-stone-500 opacity-70'}`}>
      {isDarkMode ? <Moon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : <Sun className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
    </span>
  </button>
);
