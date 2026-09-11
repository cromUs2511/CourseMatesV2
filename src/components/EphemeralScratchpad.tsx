import React, { useState } from 'react';
import { Trash2, Copy, Check, FileCode, Terminal, X } from 'lucide-react';
import { playChime } from '../utils/sound';

interface EphemeralScratchpadProps {
  isOpen: boolean;
  onClose: () => void;
  peerHandle: string;
}

export const EphemeralScratchpad: React.FC<EphemeralScratchpadProps> = ({
  isOpen,
  onClose,
  peerHandle,
}) => {
  const [content, setContent] = useState(
    `// COURSEMATES LIVE EPHEMERAL SCRATCHPAD [CAD / SPEC BUFFER]
// Volatile memory storage: purged upon peer disconnection.

#include <iostream>
using namespace std;

int main() {
    cout << "Engineering Peer Session Active." << endl;
    return 0;
}`
  );
  const [language, setLanguage] = useState('cpp');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    playChime('message');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setContent('');
    playChime('purge');
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-[#14171D] text-[#E6EDF3] border-l-2 border-black dark:border-stone-500 shadow-[0_0_0_1000px_rgba(0,0,0,0.5)] flex flex-col font-mono">
      {/* Title Bar */}
      <div className="p-3.5 border-b-2 border-black dark:border-stone-600 flex items-center justify-between bg-[#101216]">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 border-2 border-black bg-[#990000] text-white flex items-center justify-center font-bold text-xs shadow-[2px_2px_0px_#000]">
            <FileCode className="w-4 h-4 text-[#FFD700]" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              SCRATCHPAD // RAM BUFFER
            </h3>
            <p className="text-[10px] text-stone-400 truncate">PEER_TARGET: {peerHandle}</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 border border-black bg-[#252932] hover:bg-stone-700 text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Control Bar */}
      <div className="px-3 py-2 bg-[#0E1116] border-b-2 border-black dark:border-stone-600 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-[#1A1F26] border-2 border-black text-white text-xs px-2 py-1 focus:outline-none"
          >
            <option value="cpp">C++ (CS/ENG)</option>
            <option value="python">Python 3</option>
            <option value="java">Java SE</option>
            <option value="math">LaTeX / Math Proof</option>
            <option value="markdown">Markdown Notes</option>
          </select>

          <span className="text-[10px] border border-black bg-[#DCFCE7] text-[#14532D] px-1.5 py-0.5 font-bold">
            RAM_SYNCED
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={handleCopy}
            className="p-1.5 border border-black bg-[#252932] hover:bg-stone-700 text-white cursor-pointer"
            title="Copy buffer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleClear}
            className="p-1.5 border border-black bg-[#252932] hover:bg-[#990000] text-white cursor-pointer"
            title="Purge buffer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Text Area */}
      <div className="flex-1 p-3 bg-[#0A0D12]">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste code or math formulas here..."
          className="w-full h-full bg-transparent text-stone-200 font-mono text-xs p-2 leading-relaxed resize-none focus:outline-none placeholder-stone-600"
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="p-3 border-t-2 border-black dark:border-stone-600 bg-[#101216] text-[11px] text-stone-400 flex items-center justify-between">
        <span className="text-[10px]">NON-VOLATILE WRITES: NONE</span>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 border-2 border-black bg-black text-white font-bold uppercase text-xs shadow-[2px_2px_0px_#990000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
        >
          {copied ? 'COPIED TO CLIPBOARD' : 'COPY BUFFER'}
        </button>
      </div>
    </div>
  );
};
