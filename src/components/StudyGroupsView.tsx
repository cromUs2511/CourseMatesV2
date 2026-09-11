import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  ArrowRight,
  Send,
  X,
  Lock,
  Terminal,
  Grid,
} from 'lucide-react';
import { StudyGroupRoom, StudentSession, Campus } from '../types';
import { playChime } from '../utils/sound';

interface StudyGroupsViewProps {
  session: StudentSession;
}

export const StudyGroupsView: React.FC<StudyGroupsViewProps> = ({ session }) => {
  const [groups, setGroups] = useState<StudyGroupRoom[]>([]);
  const [, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<StudyGroupRoom | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [newSubject, setNewSubject] = useState('CS102');
  const [newTopic, setNewTopic] = useState('');
  const [newCampus] = useState<Campus>('Main Campus');

  const [groupMessages, setGroupMessages] = useState<
    Array<{ id: string; sender: string; avatar: string; text: string; time: string }>
  >([]);
  const [groupInput, setGroupInput] = useState('');

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/study-groups');
      const data = await res.json();
      setGroups(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const res = await fetch('/api/study-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          subjectCode: newSubject,
          topic: newTopic || 'General Problem Solving',
          campus: newCampus,
          activeTopicDescription: newTopic || 'Group problem solving in progress.',
        }),
      });
      const created = await res.json();
      setGroups((prev) => [created, ...prev]);
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewTopic('');
      playChime('match');
      joinGroup(created);
    } catch (e) {
      console.error(e);
    }
  };

  const joinGroup = (grp: StudyGroupRoom) => {
    setActiveGroup(grp);
    setGroupMessages([
      {
        id: 'sys-1',
        sender: 'CourseMates',
        avatar: '🛡️',
        text: `HUDDLE ACTIVATED // "${grp.title}". All collaborative notes and chat are held in volatile RAM only.`,
        time: 'Just now',
      },
      {
        id: 'm-1',
        sender: 'Keen Builder #4912',
        avatar: '📐',
        text: 'Welcome to the session! Checking plate calculations.',
        time: '2m ago',
      },
    ]);
    playChime('match');
  };

  const handleSendGroupMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupInput.trim()) return;

    setGroupMessages((prev) => [
      ...prev,
      {
        id: `gmsg_${Date.now()}`,
        sender: session.sessionHandle,
        avatar: session.sessionAvatar,
        text: groupInput.trim(),
        time: 'Just now',
      },
    ]);
    setGroupInput('');
  };

  return (
    <div className="flex-1 p-3 sm:p-6 md:p-8 space-y-5 max-w-6xl mx-auto w-full font-mono select-none">
      {/* Header Schematic Box */}
      <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 sm:p-6 shadow-[4px_4px_0px_#000] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-[#990000] dark:text-[#E63946] uppercase mb-1">
            <Terminal className="w-4 h-4" />
            <span>COMMUNITY CLUSTERS // COLLABORATIVE DRAWINGS</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black tracking-tight text-black dark:text-white uppercase">
            EPHEMERAL STUDY HUDDLES
          </h2>
          <p className="text-xs text-stone-600 dark:text-stone-400 mt-1 max-w-xl leading-relaxed">
            Multi-peer problem-solving nodes (2–6 verified students). Shared scratchpad buffers, zero disk transcripts.
          </p>
        </div>

        <button
          id="create-huddle-btn"
          onClick={() => setIsCreateModalOpen(true)}
          className="py-3 px-5 border-2 border-black bg-black text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-2 shadow-[3px_3px_0px_#990000] hover:bg-[#1A1A1A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4 text-[#FFD700]" />
          <span>INITIALIZE NEW HUDDLE</span>
        </button>
      </div>

      {/* Active Groups Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((grp) => (
          <div
            key={grp.id}
            className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-start justify-between gap-2 border-b-2 border-black dark:border-stone-600 pb-2">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 border border-black bg-black text-white text-xs font-bold">
                    {grp.subjectCode}
                  </span>
                  <span className="px-2 py-0.5 border border-black dark:border-stone-600 text-xs font-bold text-stone-700 dark:text-stone-300">
                    {grp.campus}
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 text-[11px] font-bold border border-black px-2 py-0.5 bg-[#DCFCE7] text-[#14532D]">
                  <Users className="w-3.5 h-3.5" />
                  <span>{grp.membersCount} ACTIVE PEERS</span>
                </div>
              </div>

              <div className="pt-3 space-y-1">
                <h3 className="text-sm font-black uppercase text-black dark:text-white">
                  {grp.title}
                </h3>
                <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                  {grp.activeTopicDescription}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t-2 border-black dark:border-stone-600 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[10px] text-stone-500 uppercase flex items-center space-x-1">
                <Lock className="w-3 h-3 text-[#990000]" />
                <span>EPHEMERAL RAM PROTOCOL</span>
              </span>
              <button
                onClick={() => joinGroup(grp)}
                className="px-3.5 py-1.5 border-2 border-black bg-black text-white text-xs font-bold uppercase shadow-[2px_2px_0px_#990000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer flex items-center space-x-1"
              >
                <span>ENTER NODE</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#FFD700]" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Active Group Chat / Scratchpad Drawer (Strict Brutalist 0px) */}
      {activeGroup && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-6 font-mono">
          <div className="w-full max-w-2xl max-h-[88vh] border-2 border-black dark:border-stone-500 bg-white dark:bg-[#14171D] shadow-[6px_6px_0px_#000] flex flex-col overflow-hidden">
            {/* Modal Title Bar */}
            <div className="p-3 sm:p-4 border-b-2 border-black dark:border-stone-600 flex items-center justify-between bg-[#F4F1EA] dark:bg-[#181B20]">
              <div className="flex items-center space-x-2 truncate">
                <span className="px-2 py-0.5 border border-black bg-black text-white text-xs font-bold shrink-0">
                  {activeGroup.subjectCode}
                </span>
                <h3 className="text-xs sm:text-sm font-black uppercase truncate text-black dark:text-white">
                  HUDDLE: {activeGroup.title}
                </h3>
              </div>
              <button
                onClick={() => setActiveGroup(null)}
                className="p-1 border border-black bg-white dark:bg-[#252932] text-xs font-bold cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAF8F5] dark:bg-[#0E1116]">
              {groupMessages.map((msg) => (
                <div key={msg.id} className="p-2.5 border-2 border-black dark:border-stone-600 bg-white dark:bg-[#181B20] text-xs shadow-[2px_2px_0px_#000]">
                  <div className="flex items-center justify-between text-[10px] text-stone-500 border-b border-stone-200 dark:border-stone-700 pb-1 mb-1">
                    <span className="font-bold text-black dark:text-white">{msg.sender}</span>
                    <span>{msg.time}</span>
                  </div>
                  <p className="text-stone-800 dark:text-stone-200 leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>

            {/* Message Input Form */}
            <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t-2 border-black dark:border-stone-600 bg-white dark:bg-[#181B20]">
              <form onSubmit={handleSendGroupMessage} className="flex flex-col gap-2 sm:flex-row sm:space-x-2">
                <input
                  type="text"
                  value={groupInput}
                  onChange={(e) => setGroupInput(e.target.value)}
                  placeholder="TRANSMIT TO HUDDLE NODE..."
                  className="flex-1 px-3 py-2 border-2 border-black dark:border-stone-500 text-xs bg-[#F9F8F6] dark:bg-[#1E232B] text-black dark:text-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-4 py-2 border-2 border-black bg-black text-white text-xs font-bold uppercase shadow-[2px_2px_0px_#990000] cursor-pointer"
                >
                  SEND
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 font-mono">
          <div className="max-w-md w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[6px_6px_0px_#000] space-y-4">
            <div className="flex items-center justify-between border-b-2 border-black dark:border-stone-600 pb-3">
              <h3 className="text-xs sm:text-sm font-black uppercase text-black dark:text-white">
                INITIALIZE STUDY HUDDLE
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 border border-black bg-[#F4F1EA] text-xs font-bold cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase mb-1">
                  HUDDLE SPECIFICATION TITLE
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. CS102 Machine Problem 2 Analysis"
                  className="w-full p-2 border-2 border-black dark:border-stone-500 text-xs bg-white dark:bg-[#1E232B]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase mb-1">
                  COURSE / SUBJECT CODE
                </label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="e.g. CS102, MATH024, PHY011"
                  className="w-full p-2 border-2 border-black dark:border-stone-500 text-xs bg-white dark:bg-[#1E232B]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase mb-1">
                  PROBLEM / TOPIC FOCUS
                </label>
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="e.g. Plate 3, Circuit analysis, Euler method"
                  className="w-full p-2 border-2 border-black dark:border-stone-500 text-xs bg-white dark:bg-[#1E232B]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-3 py-2 border-2 border-black text-xs font-bold uppercase cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border-2 border-black bg-black text-white text-xs font-bold uppercase shadow-[2px_2px_0px_#990000] cursor-pointer"
                >
                  DEPLOY NODE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
