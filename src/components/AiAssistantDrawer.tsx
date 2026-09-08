import React, { useState } from 'react';
import { Terminal, HelpCircle, FileText, Send, X, Bot, Lightbulb, Check, Cpu } from 'lucide-react';
import { ChatMessage } from '../types';
import { playChime } from '../utils/sound';

interface AiAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  topic: string;
  chatHistory: ChatMessage[];
  onInsertMessage: (text: string) => void;
}

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({
  isOpen,
  onClose,
  topic,
  chatHistory,
  onInsertMessage,
}) => {
  const [conceptQuery, setConceptQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiOutput, setAiOutput] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'wingman' | 'explain' | 'summary'>('wingman');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleAction = async (actionType: 'nudge' | 'explain' | 'summarize') => {
    setLoading(true);
    setAiOutput(null);

    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionType,
          topic,
          query: conceptQuery,
          chatHistory: chatHistory.map((m) => ({
            sender: m.senderHandle,
            text: m.text,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Assistant unavailable.');
      setAiOutput(data.result || 'No response from assistant.');
      playChime('message');
    } catch (err) {
      console.error(err);
      setAiOutput('Could not reach Gemini Assistant right now. You can continue chatting directly!');
    } finally {
      setLoading(false);
    }
  };

  const handleSendToChat = () => {
    if (aiOutput) {
      onInsertMessage(aiOutput);
      playChime('message');
      onClose();
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#161B22] text-[#E6EDF3] border-l-2 border-black dark:border-stone-500 shadow-[0_0_0_1000px_rgba(0,0,0,0.5)] flex flex-col font-mono">
      {/* Title Spec Bar */}
      <div className="p-3.5 border-b-2 border-black dark:border-stone-600 flex items-center justify-between bg-[#12151B]">
        <div className="flex min-w-0 items-center space-x-2">
          <div className="w-7 h-7 border-2 border-black bg-[#990000] text-white flex items-center justify-center font-bold text-xs shadow-[2px_2px_0px_#000]">
            <Cpu className="w-4 h-4 text-[#FFD700]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              STUDY ASSISTANT
            </h3>
            <p className="truncate text-[10px] text-stone-400">TELEMETRY ICEBREAKER & REASONING</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 border border-black bg-[#252932] hover:bg-stone-700 text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs (Strict Brutalist 0px) */}
      <div className="grid grid-cols-3 p-2 bg-[#0E1116] border-b-2 border-black dark:border-stone-600 gap-1 text-[11px]">
        <button
          onClick={() => {
            setActiveTab('wingman');
            handleAction('nudge');
          }}
          className={`py-2 px-1 border-2 border-black font-bold uppercase transition-all cursor-pointer ${
            activeTab === 'wingman'
              ? 'bg-black text-white shadow-[2px_2px_0px_#990000] translate-x-[1px] translate-y-[1px]'
              : 'bg-[#1E232B] text-stone-300 hover:bg-[#2A313C]'
          }`}
        >
          NUDGE
        </button>

        <button
          onClick={() => {
            setActiveTab('explain');
          }}
          className={`py-2 px-1 border-2 border-black font-bold uppercase transition-all cursor-pointer ${
            activeTab === 'explain'
              ? 'bg-black text-white shadow-[2px_2px_0px_#990000] translate-x-[1px] translate-y-[1px]'
              : 'bg-[#1E232B] text-stone-300 hover:bg-[#2A313C]'
          }`}
        >
          EXPLAIN
        </button>

        <button
          onClick={() => {
            setActiveTab('summary');
            handleAction('summarize');
          }}
          className={`py-2 px-1 border-2 border-black font-bold uppercase transition-all cursor-pointer ${
            activeTab === 'summary'
              ? 'bg-black text-white shadow-[2px_2px_0px_#990000] translate-x-[1px] translate-y-[1px]'
              : 'bg-[#1E232B] text-stone-300 hover:bg-[#2A313C]'
          }`}
        >
          TAKEAWAYS
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'wingman' && (
          <div className="space-y-3">
            <p className="text-xs text-stone-300 leading-relaxed">
              Analyzes current session parameters (<strong>{topic}</strong>) to supply engineering talking points.
            </p>
            <button
              onClick={() => handleAction('nudge')}
              disabled={loading}
              className="w-full py-2.5 px-3 border-2 border-black bg-black text-white text-xs font-bold uppercase tracking-wider shadow-[3px_3px_0px_#990000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
            >
              {loading ? 'ANALYZING THREAD...' : 'GENERATE TALKING POINTS'}
            </button>
          </div>
        )}

        {activeTab === 'explain' && (
          <div className="space-y-3">
            <p className="text-xs text-stone-300 leading-relaxed">
              Enter any engineering theorem, equation, or algorithm for an immediate mathematical breakdown.
            </p>
            <div className="space-y-2">
              <input
                type="text"
                value={conceptQuery}
                onChange={(e) => setConceptQuery(e.target.value)}
                placeholder="e.g. Mohr's Circle, Dijkstra, Fourier Transform"
                className="w-full px-3 py-2 bg-[#0E1116] border-2 border-black text-xs text-white placeholder-stone-500 focus:outline-none"
              />
              <button
                onClick={() => handleAction('explain')}
                disabled={loading || !conceptQuery.trim()}
                className="w-full py-2.5 px-3 border-2 border-black bg-black text-white text-xs font-bold uppercase tracking-wider shadow-[3px_3px_0px_#990000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer disabled:opacity-50"
              >
                {loading ? 'DECONSTRUCTING CONCEPT...' : 'DECONSTRUCT CONCEPT'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="space-y-3">
            <p className="text-xs text-stone-300 leading-relaxed">
              Synthesize key takeaways exchanged in this ephemeral session before memory buffer wipe.
            </p>
            <button
              onClick={() => handleAction('summarize')}
              disabled={loading}
              className="w-full py-2.5 px-3 border-2 border-black bg-black text-white text-xs font-bold uppercase tracking-wider shadow-[3px_3px_0px_#990000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
            >
              {loading ? 'COMPILING SUMMARY...' : 'COMPILE TAKEAWAYS'}
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="p-4 border-2 border-black bg-[#0E1116] text-center space-y-2">
            <div className="w-2 h-2 bg-[#990000] animate-ping mx-auto" />
            <p className="text-xs text-stone-400 uppercase">RUNNING GEMINI COGNITIVE PASS...</p>
          </div>
        )}

        {/* AI Output Box */}
        {aiOutput && !loading && (
          <div className="p-3 border-2 border-black bg-[#0E1116] shadow-[3px_3px_0px_#000] space-y-3">
            <div className="flex items-center justify-between text-xs text-stone-400 border-b border-stone-800 pb-2">
              <span className="font-bold text-white flex items-center space-x-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#990000]" />
                <span>INFERENCE SPECIFICATION</span>
              </span>
              <span className="text-[10px] text-stone-500 uppercase">RAM EPHEMERAL</span>
            </div>
            <div className="text-xs text-stone-200 leading-relaxed whitespace-pre-wrap">
              {aiOutput}
            </div>

            <div className="flex flex-col items-stretch gap-2 space-x-0 pt-2 border-t border-stone-800 sm:flex-row sm:items-center sm:space-x-2">
              <button
                onClick={handleSendToChat}
                className="flex-1 py-2 px-3 border-2 border-black bg-black text-white text-xs font-bold uppercase tracking-wider shadow-[2px_2px_0px_#990000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer flex items-center justify-center space-x-1"
              >
                <Send className="w-3 h-3" />
                <span>INSERT TO CHAT</span>
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(aiOutput);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="py-2 px-3 border-2 border-black bg-[#252932] text-white text-xs font-bold uppercase shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer flex items-center space-x-1"
              >
                {copied ? <Check className="w-3 h-3 text-[#10B981]" /> : 'COPY'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
