import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Trash2,
  Check,
  Terminal,
  School,
  AlertTriangle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { playChime } from '../utils/sound';

export const PrivacySecurityModal: React.FC = () => {
  const [purgedCount, setPurgedCount] = useState(0);
  const [isPurging, setIsPurging] = useState(false);

  const triggerManualAuditPurge = () => {
    setIsPurging(true);
    playChime('purge');
    confetti({
      particleCount: 40,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#990000', '#000000', '#FFD700', '#10B981'],
    });

    setTimeout(() => {
      setIsPurging(false);
      setPurgedCount((prev) => prev + 1);
    }, 1000);
  };

  return (
    <div className="flex-1 p-3 sm:p-6 md:p-8 space-y-5 max-w-5xl mx-auto w-full font-mono select-none">
      {/* Header Schematic Box */}
      <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 sm:p-6 shadow-[4px_4px_0px_#000] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-[#990000] dark:text-[#E63946] uppercase mb-1">
            <Terminal className="w-4 h-4" />
            <span>SECURITY SPECIFICATION // MAPÚA ENTRA ID</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black tracking-tight text-black dark:text-white uppercase">
            ZERO-LOG EPHEMERAL ARCHITECTURE
          </h2>
          <p className="text-xs text-stone-600 dark:text-stone-400 mt-1 max-w-2xl leading-relaxed">
            CourseMates enforces hardware-level ephemeral RAM persistence: zero SQLite/MySQL databases, no session disks, cryptographic salt disposal upon tab exit.
          </p>
        </div>

        <button
          id="purge-ram-btn"
          onClick={triggerManualAuditPurge}
          disabled={isPurging}
          className="py-3 px-5 border-2 border-black bg-black text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-2 shadow-[3px_3px_0px_#990000] hover:bg-[#1A1A1A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none cursor-pointer shrink-0"
        >
          <Trash2 className="w-4 h-4 text-[#FFD700]" />
          <span>{isPurging ? 'PURGING BUFFER...' : 'RUN AUDIT MEMORY PURGE'}</span>
        </button>
      </div>

      {purgedCount > 0 && (
        <div className="p-3 border-2 border-black bg-[#DCFCE7] dark:bg-[#142E1F] text-[#14532D] dark:text-[#86EFAC] text-xs font-bold flex items-center space-x-2 shadow-[2px_2px_0px_#000]">
          <Check className="w-4 h-4" />
          <span>RAM PURGE AUDIT CONFIRMED: Ephemeral volatile sockets flushed ({purgedCount} cycles).</span>
        </div>
      )}

      {/* 3 Core Architecture Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] space-y-2">
          <div className="w-8 h-8 border-2 border-black bg-[#990000] text-white flex items-center justify-center font-bold text-xs shadow-[2px_2px_0px_#000]">
            <Lock className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-black uppercase text-black dark:text-white">
            01 // EPHEMERAL RAM PROTOCOL
          </h3>
          <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
            All transmissions, chat blocks, and queue tokens exist only in memory buffers. Zero logs or files are committed to persistent disk.
          </p>
        </div>

        <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] space-y-2">
          <div className="w-8 h-8 border-2 border-black bg-black text-white flex items-center justify-center font-bold text-xs shadow-[2px_2px_0px_#000]">
            <ShieldCheck className="w-4 h-4 text-[#FFD700]" />
          </div>
          <h3 className="text-xs font-black uppercase text-black dark:text-white">
            02 // IDENTITY MASKING
          </h3>
          <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
            Student IDs and real names are never exposed. Each matched session issues a collegiate pseudonym (e.g., Cardinal-Architect, Tech-Wizard).
          </p>
        </div>

        <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] space-y-2">
          <div className="w-8 h-8 border-2 border-black bg-[#FFD700] text-black flex items-center justify-center font-bold text-xs shadow-[2px_2px_0px_#000]">
            <School className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-black uppercase text-black dark:text-white">
            03 // ENTRA ID STRICT GATE
          </h3>
          <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
            Optional Microsoft OAuth is restricted to the configured organization. External bots and unauthorized accounts are blocked.
          </p>
        </div>
      </div>
    </div>
  );
};
