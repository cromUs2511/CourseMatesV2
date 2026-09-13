import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, RefreshCw, Settings2, X } from 'lucide-react';
import { StudentSession } from '../types';
import { ThemeToggle } from './ThemeToggle';
import { SoundToggle } from './SoundToggle';

export interface HeaderProps {
  session: StudentSession | null;
  onRerollHandle: () => void;
  onLogout: () => void;
  onlineCount?: number;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  isSoundEnabled: boolean;
  onToggleSound: () => void;
  showReroll?: boolean;
  conversation?: React.ReactNode;
  chatActions?: React.ReactNode;
  displayActions?: React.ReactNode;
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
  conversation,
  chatActions,
  displayActions,
}) => {
  const [isLogoutConfirmationOpen, setIsLogoutConfirmationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const cancelLogoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    if (settingsPanelRef.current) settingsPanelRef.current.scrollTop = 0;
    const closeOutside = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        settingsButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (isLogoutConfirmationOpen) cancelLogoutRef.current?.focus();
  }, [isLogoutConfirmationOpen]);

  return (
    <header
      id="main-header"
      className={`relative shrink-0 w-full z-40 transition-colors duration-150 border-b backdrop-blur-xl ${
        conversation ? (isDarkMode ? 'bg-[#141312]/82 border-stone-800 text-stone-100' : 'bg-[#fffdfa]/82 border-stone-200 text-stone-900') : isDarkMode
          ? 'bg-[#181716]/82 border-stone-800 text-stone-100 shadow-sm'
          : 'bg-[#fffdfa]/82 border-stone-200 text-stone-900 shadow-sm'
      }`}
    >
      <div className="w-full px-3 sm:px-5 lg:px-8">
        <div id={conversation ? 'chat-header' : undefined} className={`flex min-h-16 items-center gap-2.5 py-2 ${conversation ? 'min-[768px]:grid min-[768px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : ''}`}>
          <div className={`${conversation ? 'hidden min-[768px]:block' : 'block'} min-w-0 flex-1`}>
            {conversation ? (
              <div className="flex items-center gap-2">
                <ThemeToggle isDarkMode={isDarkMode} onToggle={onToggleDarkMode} className="shadow-sm" />
                {session && (
                  <div className={`min-w-0 max-w-40 truncate rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm ${
                    isDarkMode ? 'border-stone-700 bg-stone-900/80 text-stone-200' : 'border-stone-200 bg-white/80 text-stone-800'
                  }`} title={`You: ${session.sessionHandle}`}>
                    {session.sessionHandle}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ThemeToggle
                  id="dark-mode-toggle-btn"
                  isDarkMode={isDarkMode}
                  onToggle={onToggleDarkMode}
                  className="shadow-sm"
                />
                {displayActions}
              </div>
            )}
          </div>
          {conversation && <div className="min-w-0 flex-1 text-center min-[768px]:flex-none min-[768px]:justify-self-center">{conversation}</div>}
          <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 min-[768px]:justify-self-end">
            <div ref={settingsRef} className="shrink-0 min-[900px]:relative">
            {conversation && <button
              ref={settingsButtonRef}
              type="button"
              aria-label="Account and display settings"
              aria-expanded={settingsOpen}
              aria-controls="header-settings"
              onClick={() => setSettingsOpen(value => !value)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800 min-[900px]:hidden"
            ><Settings2 className="h-4 w-4" /></button>}
          <div ref={settingsPanelRef} id="header-settings" className={conversation
            ? `${settingsOpen ? 'flex' : 'hidden'} absolute right-3 top-full mt-2 z-50 max-h-[calc(100dvh-84px)] w-72 max-w-[calc(100vw-24px)] overflow-y-auto flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-[#fffdfa] p-3 text-xs shadow-[0_22px_60px_rgba(41,37,36,0.18)] dark:border-stone-700 dark:bg-[#1c1b1a] min-[900px]:static min-[900px]:mt-0 min-[900px]:flex min-[900px]:w-auto min-[900px]:max-h-none min-[900px]:max-w-none min-[900px]:overflow-visible min-[900px]:flex-nowrap min-[900px]:rounded-none min-[900px]:border-0 min-[900px]:bg-transparent min-[900px]:p-0 min-[900px]:shadow-none min-[900px]:dark:bg-transparent`
            : 'flex items-center gap-2 text-xs'}>
            {conversation && <p className="w-full px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400 min-[900px]:hidden">Appearance &amp; account</p>}
            {/* Dark / Light Theme Toggle */}
            {conversation && <ThemeToggle
              id="dark-mode-toggle-btn"
              isDarkMode={isDarkMode}
              onToggle={onToggleDarkMode}
              className="shadow-sm min-[768px]:hidden"
            />}
            <SoundToggle isEnabled={isSoundEnabled} onToggle={onToggleSound} />
            <button
              id="logout-btn"
              type="button"
              aria-label="Disconnect and log out"
              title="Disconnect and log out"
              onClick={() => { setSettingsOpen(false); setIsLogoutConfirmationOpen(true); }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950"
            >
              <LogOut className="h-4 w-4" />
            </button>

            {/* Authenticated Identity Badge - No user emojis or icons */}
            {session && (
              <div className={conversation ? 'order-first w-full border-b border-stone-200 pb-3 dark:border-stone-700 min-[768px]:hidden' : 'flex items-center space-x-2 pl-1 sm:pl-2 border-l border-stone-200 dark:border-stone-800'}>
                <div
                  className={`flex items-center space-x-2 px-2.5 py-1.5 border rounded-lg text-xs shadow-sm ${
                    isDarkMode
                      ? 'bg-stone-900 border-stone-700 text-stone-200'
                      : 'bg-white border-stone-200 text-stone-800'
                  }`}
                >
                  <span
                    className={conversation ? 'inline max-w-[140px] truncate font-semibold' : 'inline max-w-[92px] sm:max-w-[140px] truncate font-semibold'}
                    title={conversation ? `You: ${session.sessionHandle}` : session.sessionHandle}
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
            {conversation && displayActions && <div className="flex w-full flex-wrap items-center gap-2 border-t border-stone-200 pt-2 dark:border-stone-700 min-[900px]:w-auto min-[900px]:flex-nowrap min-[900px]:border-t-0 min-[900px]:pt-0">{displayActions}</div>}
            </div>
            </div>
            {chatActions && <div className="chat-actions flex shrink-0 items-center gap-1.5">{chatActions}</div>}
          </div>
        </div>
      </div>
      {isLogoutConfirmationOpen && createPortal(
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
        </div>,
        document.fullscreenElement || document.body,
      )}
    </header>
  );
};
