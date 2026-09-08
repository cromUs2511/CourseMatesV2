import React from 'react';
import { RefreshCw, LogOut, Sun, Moon } from 'lucide-react';
import { StudentSession } from '../types';
import { TopMusicBar } from './TopMusicBar';

interface HeaderProps {
  session: StudentSession | null;
  onRerollHandle: () => void;
  onLogout: () => void;
  onlineCount?: number;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  onRerollHandle,
  onLogout,
  isDarkMode,
  onToggleDarkMode,
}) => {
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
        <div className="flex items-center justify-between min-h-12 sm:min-h-16 py-1.5 sm:py-2 gap-2 flex-wrap">
          {/* Center / Right: Top Music Bar replacing the Online Status */}
          <div className="order-last w-full sm:order-none sm:flex-1 flex justify-center sm:justify-end items-center sm:max-w-md min-w-0">
            <TopMusicBar isDarkMode={isDarkMode} />
          </div>

          {/* Right: Controls & Persona Handle */}
          <div className="flex items-center space-x-2 text-xs shrink-0">
            {/* Dark / Light Theme Toggle */}
            <button
              id="dark-mode-toggle-btn"
              onClick={onToggleDarkMode}
              className={`p-2 border rounded-lg transition-all cursor-pointer shadow-sm hover:-translate-y-0.5 ${
                isDarkMode
                  ? 'bg-stone-900 border-stone-800 text-amber-400 hover:bg-stone-800'
                  : 'bg-stone-50 border-stone-300 text-stone-700 hover:bg-stone-100 hover:text-stone-900'
              }`}
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
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
                  {!session.customHandle && <button
                      id="reroll-handle-btn"
                      title="Reroll Anonymous Handle"
                      onClick={onRerollHandle}
                      className="text-stone-400 hover:text-[#991B1B] dark:hover:text-[#F87171] p-0.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>}
                </div>

                {/* Logout Button */}
                <button
                  id="logout-btn"
                  onClick={onLogout}
                  className={`p-2 border rounded-lg transition-all cursor-pointer shadow-sm hover:-translate-y-0.5 ${
                    isDarkMode
                      ? 'bg-stone-900 border-stone-800 text-stone-400 hover:text-red-400 hover:bg-stone-800'
                      : 'bg-stone-50 border-stone-300 text-stone-600 hover:text-red-600 hover:bg-stone-100'
                  }`}
                  title="Disconnect & Purge Session"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
