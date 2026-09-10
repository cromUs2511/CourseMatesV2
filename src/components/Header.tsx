import React, { useEffect, useRef, useState } from 'react';
import { LogOut, RefreshCw, X } from 'lucide-react';
import { StudentSession } from '../types';
import { ThemeToggle } from './ThemeToggle';
import { SoundToggle } from './SoundToggle';

interface HeaderProps {
  session: StudentSession | null;
  onRerollHandle: () => void;
  onLogout: () => void;
  onlineCount?: number;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  isSoundEnabled: boolean;
  onToggleSound: () => void;
  showReroll?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  onRerollHandle,
  onLogout,
  isDarkMode,
  onToggleDarkMode,
  isSoundEnabled,
  onToggleSound,
  showReroll = true,
}) => {
  const [isLogoutConfirmationOpen, setIsLogoutConfirmationOpen] = useState(false);
  const cancelLogoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isLogoutConfirmationOpen) cancelLogoutRef.current?.focus();
  }, [isLogoutConfirmationOpen]);

  return (
    <header
      id="main-header"
      className={`shrink-0 w-full z-40 transition-colors duration-150 border-b ${
        isDarkMode
          ? 'bg-[#181716] border-stone-800 text-stone-100 shadow-sm'
          : 'bg-white border-stone-300 text-stone-900 shadow-sm'
      }`}
    >
      <div className="w-full px-4 sm:px-6">
        <div className="flex items-center justify-between min-h-12 sm:min-h-16 py-1 sm:py-2 gap-1.5 flex-wrap">
          {/* Right: Controls & Persona Handle */}
          <div className="flex items-center space-x-2 text-xs shrink-0">
            {/* Dark / Light Theme Toggle */}
            <ThemeToggle
              id="dark-mode-toggle-btn"
              isDarkMode={isDarkMode}
              onToggle={onToggleDarkMode}
              className="shadow-sm hover:-translate-y-0.5"
            />
            <SoundToggle isEnabled={isSoundEnabled} onToggle={onToggleSound} />
            <button
              id="logout-btn"
              type="button"
              aria-label="Disconnect and log out"
              title="Disconnect and log out"
              onClick={() => setIsLogoutConfirmationOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-300 bg-red-50 text-red-700 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950"
            >
              <LogOut className="h-4 w-4" />
            </button>

            {/* Authenticated Identity Badge - No user emojis or icons */}
            {session && (
              <div className="flex items-center space-x-2 pl-1 sm:pl-2 border-l border-stone-200 dark:border-stone-800">
                <div
                  className={`flex items-center space-x-2 px-2.5 py-1.5 border rounded-lg text-xs font-mono shadow-sm ${
                    isDarkMode
                      ? 'bg-stone-900 border-stone-800 text-stone-200'
                      : 'bg-stone-50 border-stone-300 text-stone-800'
                  }`}
                >
                  <span
                    className="inline max-w-[92px] sm:max-w-[140px] truncate font-semibold"
                    title={session.sessionHandle}
                  >
                    {session.sessionHandle}
                  </span>
                  {showReroll && !session.customHandle && <button
                      id="reroll-handle-btn"
                      title="Reroll Anonymous Handle"
                      onClick={onRerollHandle}
                      className="text-stone-400 hover:text-[#991B1B] dark:hover:text-[#F87171] p-0.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
      {isLogoutConfirmationOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="logout-confirmation-title" className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
            isDarkMode ? 'border-stone-700 bg-[#181716] text-stone-100' : 'border-stone-300 bg-white text-stone-900'
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="logout-confirmation-title" className="text-base font-semibold">Log out?</h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Your current chat will end and its messages will be cleared.</p>
              </div>
              <button type="button" aria-label="Close logout confirmation" onClick={() => setIsLogoutConfirmationOpen(false)} className="rounded-lg p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelLogoutRef} type="button" onClick={() => setIsLogoutConfirmationOpen(false)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">Cancel</button>
              <button type="button" onClick={onLogout} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800">Log out</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
