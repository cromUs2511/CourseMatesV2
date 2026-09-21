import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface SoundToggleProps {
  isEnabled: boolean;
  onToggle: () => void;
  className?: string;
  compact?: boolean;
}

export const SoundToggle: React.FC<SoundToggleProps> = ({ isEnabled, onToggle, className = '', compact = false }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={isEnabled ? 'Disable chat sound' : 'Enable chat sound'}
    title={isEnabled ? 'Disable Chat Sound' : 'Enable Chat Sound'}
    aria-pressed={isEnabled}
    className={`inline-flex items-center justify-center transition-colors ${compact ? 'chat-display-control h-8 w-8 rounded-lg' : 'h-8 w-8 rounded-lg border'} ${
      isEnabled
        ? compact ? 'text-[#c8bb8d] hover:bg-white/10' : 'border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800'
        : compact ? 'text-red-300 hover:bg-white/10' : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950'
    } ${className}`}
  >
    {isEnabled ? <Volume2 className={compact ? 'h-3 w-3' : 'h-4 w-4'} /> : <VolumeX className={compact ? 'h-3 w-3' : 'h-4 w-4'} />}
  </button>
);
