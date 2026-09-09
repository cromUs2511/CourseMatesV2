import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface SoundToggleProps {
  isEnabled: boolean;
  onToggle: () => void;
  className?: string;
}

export const SoundToggle: React.FC<SoundToggleProps> = ({ isEnabled, onToggle, className = '' }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={isEnabled ? 'Disable chat sound' : 'Enable chat sound'}
    title={isEnabled ? 'Disable Chat Sound' : 'Enable Chat Sound'}
    aria-pressed={isEnabled}
    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
      isEnabled
        ? 'border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800'
        : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950'
    } ${className}`}
  >
    {isEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
  </button>
);
