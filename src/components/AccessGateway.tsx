import React, { useState } from 'react';
import { Shield, ArrowRight, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { StudentSession, AcademicDiscipline, Campus } from '../types';
import { playChime } from '../utils/sound';

interface AccessGatewayProps {
  onVerified: (session: StudentSession) => void;
  isDarkMode?: boolean;
}

const MAPUA_SCHOOLS: { name: AcademicDiscipline; code: string; label: string }[] = [
  { name: 'Computer Science & IT', code: 'SOIT', label: 'SOIT • School of Information Technology' },
  { name: 'Civil & Environmental Engineering', code: 'SCEGE', label: 'SCEGE • School of Civil & Environmental Eng.' },
  { name: 'Electrical, Electronics & Computer Engineering', code: 'EECE', label: 'EECE • Electrical, Electronics & Computer Eng.' },
  { name: 'Mechanical & Manufacturing Engineering', code: 'MME', label: 'MME • Mechanical & Manufacturing Eng.' },
  { name: 'Architecture & Industrial Design', code: 'ARIDBE', label: 'ARIDBE • Architecture & Industrial Design' },
  { name: 'Business & Management', code: 'ETYSBM', label: 'ETYSBM • Business & Management' },
  { name: 'Media & Visual Arts', code: 'SMVA', label: 'SMVA • Media & Visual Arts' },
  { name: 'Chemical & Materials Engineering', code: 'CBMES', label: 'CBMES • Chemical & Materials Eng.' },
  { name: 'Health & Life Sciences', code: 'SHS', label: 'SHS • School of Health Sciences' },
];

export const AccessGateway: React.FC<AccessGatewayProps> = ({ onVerified, isDarkMode = false }) => {
  const [email, setEmail] = useState('');
  const [campus, setCampus] = useState<Campus>('Intramuros');
  const [discipline, setDiscipline] = useState<AcademicDiscipline>('Computer Science & IT');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your official Mapúa student email.');
      return;
    }
    const isMapuaDomain =
      cleanEmail.endsWith('@mymail.mapua.edu.ph') ||
      cleanEmail.endsWith('@mymapua.edu.ph') ||
      cleanEmail.endsWith('@mapua.edu.ph');
    
    if (!isMapuaDomain) {
      setError('ACCESS DENIED: Please use your official Mapúa school email (@mymail.mapua.edu.ph, @mymapua.edu.ph, or @mapua.edu.ph).');
      return;
    }
    
    setError(null);
    setLoading(true);
    
    try {
      const response = await fetch('/api/auth/school-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          campus,
          discipline,
          interests: ['Coding, DSA & Software'],
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Institutional verification failed.');
      }
      setSuccessNotice(`Mapúa Identity Verified: ${data.session.email}`);
      playChime('match');
      setTimeout(() => {
        onVerified(data.session);
      }, 400);
    } catch (err: any) {
      setError(err.message || 'Verification service error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (presetEmail: string) => {
    setEmail(presetEmail);
    setError(null);
  };

  const strokeColor = isDarkMode ? "#fde047" : "#44403c";
  const gridPattern = isDarkMode
    ? 'linear-gradient(rgba(253, 224, 71, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(253, 224, 71, 0.08) 1px, transparent 1px)'
    : 'linear-gradient(rgba(87, 83, 78, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(87, 83, 78, 0.15) 1px, transparent 1px)';

  return (
    <div className={`flex h-full min-h-0 w-full overflow-y-auto font-sans transition-colors ${isDarkMode ? 'bg-[#101112] text-stone-300' : 'bg-[#f5f3ef] text-stone-800'}`}>
      <section className="relative hidden min-h-full flex-1 overflow-hidden lg:flex">
        <div className={`absolute inset-0 ${isDarkMode ? 'bg-[radial-gradient(circle_at_20%_15%,#542020_0,transparent_38%),linear-gradient(135deg,#17191b,#0d0e0f)]' : 'bg-[radial-gradient(circle_at_20%_15%,#ffe2d0_0,transparent_38%),linear-gradient(135deg,#fffaf5,#eee9e2)]'}`} />
        <div className="relative z-10 flex w-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#991B1B] text-lg font-black text-white shadow-lg shadow-red-900/20">CM</div>
              <div>
                <p className={`text-sm font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-stone-900'}`}>CourseMates</p>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#991B1B]">Mapúa network</p>
              </div>
            </div>
            <span className={`rounded-full border px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider ${isDarkMode ? 'border-stone-700 bg-white/5 text-stone-400' : 'border-stone-300 bg-white/60 text-stone-500'}`}>Private by design</span>
          </div>

          <div className="max-w-2xl">
            <p className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-[#991B1B]">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.12)]" /> Anonymous study network
            </p>
            <h1 className={`text-6xl font-black leading-[0.95] tracking-[-0.06em] xl:text-8xl ${isDarkMode ? 'text-white' : 'text-stone-900'}`}>
              Find your next<br /><span className="text-[#991B1B]">study advantage.</span>
            </h1>
            <p className={`mt-7 max-w-lg text-base leading-7 ${isDarkMode ? 'text-stone-400' : 'text-stone-600'}`}>
              Meet Mapúa peers who are working toward the same breakthrough. Focused conversations, zero public profiles, no noise.
            </p>
            <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
              {[
                ['01', 'Verified peers'],
                ['02', 'Private rooms'],
                ['03', 'Zero transcripts'],
              ].map(([number, label]) => (
                <div key={number} className={`rounded-2xl border p-4 ${isDarkMode ? 'border-white/10 bg-white/[0.04]' : 'border-stone-200 bg-white/70 shadow-sm'}`}>
                  <p className="text-xs font-black text-[#991B1B]">{number}</p>
                  <p className={`mt-2 text-xs font-semibold ${isDarkMode ? 'text-stone-300' : 'text-stone-700'}`}>{label}</p>
                </div>
              ))}
            </div>
          </div>

          <p className={`text-xs ${isDarkMode ? 'text-stone-600' : 'text-stone-400'}`}>Built for Mapúans who learn better together.</p>
        </div>
      </section>

      <section className={`flex w-full items-center justify-center px-5 py-8 sm:px-8 lg:w-[520px] lg:shrink-0 xl:w-[580px] ${isDarkMode ? 'bg-[#151617]' : 'bg-white'}`}>
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#991B1B] text-xs font-black text-white">CM</div>
              <span className="font-bold">CourseMates</span>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#991B1B]">Mapúa</span>
          </div>

          <div className={`rounded-[1.5rem] border p-6 shadow-2xl sm:p-8 ${isDarkMode ? 'border-white/10 bg-[#1c1e20] shadow-black/20' : 'border-stone-200 bg-white shadow-stone-200/70'}`}>
            <div className="mb-8 flex items-start justify-between">
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#991B1B]">Mapúa University SSO</p>
                <h2 className={`text-3xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-stone-900'}`}>Welcome back.</h2>
                <p className={`mt-2 text-sm ${isDarkMode ? 'text-stone-400' : 'text-stone-500'}`}>Verify your student identity to enter.</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-mono ${isDarkMode ? 'border-stone-700 text-stone-400' : 'border-stone-200 bg-stone-50 text-stone-500'}`}>SECURE</span>
            </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            
            <div className="space-y-2">
              <label className={`block text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-[#fef08a]' : 'text-[#9a3412]'}`}>
                Mapúa Student Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="username@mymail.mapua.edu.ph"
                className={`w-full px-4 py-3 border rounded-xl font-mono text-sm focus:outline-none transition-colors ${
                  isDarkMode 
                    ? 'bg-[#111] border-stone-800 text-white focus:border-[#dc2626] placeholder:text-stone-600' 
                    : 'bg-[#F3EFEA] border-stone-300 text-stone-900 focus:border-[#dc2626] placeholder:text-stone-400'
                }`}
              />
              <div className="flex items-center justify-between pt-1">
                <span className={`text-[10px] font-mono ${isDarkMode ? 'text-stone-500' : 'text-stone-500'}`}>
                  Accepted: @mymail.mapua.edu.ph, @mymapua.edu.ph
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className={`text-[10px] font-mono ${isDarkMode ? 'text-stone-500' : 'text-stone-500'}`}>Quick fill:</span>
                <button
                  type="button"
                  onClick={() => handleQuickFill('cardinal@mymail.mapua.edu.ph')}
                  className={`text-[10px] font-mono px-2 py-1 border rounded-md transition-colors ${
                    isDarkMode
                      ? 'border-stone-800 bg-[#111] text-stone-400 hover:border-[#dc2626] hover:text-[#dc2626]'
                      : 'border-stone-300 bg-[#F3EFEA] text-stone-600 hover:border-[#dc2626] hover:text-[#dc2626]'
                  }`}
                >
                  @mymail.mapua.edu.ph
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickFill('student@mymapua.edu.ph')}
                  className={`text-[10px] font-mono px-2 py-1 border rounded-md transition-colors ${
                    isDarkMode
                      ? 'border-stone-800 bg-[#111] text-stone-400 hover:border-[#dc2626] hover:text-[#dc2626]'
                      : 'border-stone-300 bg-[#F3EFEA] text-stone-600 hover:border-[#dc2626] hover:text-[#dc2626]'
                  }`}
                >
                  @mymapua.edu.ph
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className={`block text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-[#fef08a]' : 'text-[#9a3412]'}`}>
                Campus
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCampus('Intramuros')}
                  className={`py-3 px-3 text-sm font-semibold border rounded-lg transition-colors ${
                    campus === 'Intramuros'
                      ? 'border-[#dc2626] bg-[#dc2626] text-white'
                      : isDarkMode
                        ? 'border-stone-800 bg-[#111] text-stone-400 hover:border-stone-600'
                        : 'border-stone-300 bg-[#F3EFEA] text-stone-600 hover:border-stone-400'
                  }`}
                >
                  Intramuros (Main)
                </button>
                <button
                  type="button"
                  onClick={() => setCampus('Makati')}
                  className={`py-3 px-3 text-sm font-semibold border rounded-lg transition-colors ${
                    campus === 'Makati'
                      ? 'border-[#dc2626] bg-[#dc2626] text-white'
                      : isDarkMode
                        ? 'border-stone-800 bg-[#111] text-stone-400 hover:border-stone-600'
                        : 'border-stone-300 bg-[#F3EFEA] text-stone-600 hover:border-stone-400'
                  }`}
                >
                  Makati Campus
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className={`block text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-[#fef08a]' : 'text-[#9a3412]'}`}>
                School / Academic Department
              </label>
              <select
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value as AcademicDiscipline)}
                className={`w-full px-4 py-3 border rounded-xl font-mono text-sm focus:outline-none transition-colors appearance-none ${
                  isDarkMode 
                    ? 'bg-[#111] border-stone-800 text-white focus:border-[#dc2626]' 
                    : 'bg-[#F3EFEA] border-stone-300 text-stone-900 focus:border-[#dc2626]'
                }`}
              >
                {MAPUA_SCHOOLS.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div               className={`p-4 border rounded-xl text-xs flex items-start space-x-3 ${isDarkMode ? 'border-red-900/50 bg-red-950/20 text-red-400' : 'border-red-300 bg-red-50 text-red-700'}`}>
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="leading-snug">
                  <span className={`font-bold block ${isDarkMode ? 'text-red-300' : 'text-red-800'}`}>Authorization Denied</span>
                  <span>{error}</span>
                </div>
              </div>
            )}

            {successNotice && (
              <div               className={`p-4 border rounded-xl text-xs flex items-center space-x-3 ${isDarkMode ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}>
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span className="font-mono">{successNotice}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-sm uppercase tracking-widest transition-colors flex items-center justify-center space-x-2 shadow-[0_10px_24px_rgba(220,38,38,0.18)] hover:shadow-[0_12px_28px_rgba(220,38,38,0.28)] disabled:opacity-50 mt-4 cursor-pointer"
            >
              <span>{loading ? 'Verifying...' : 'Continue'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

          </form>

          <div className={`mt-8 space-y-3 border-t pt-5 text-[11px] font-mono ${isDarkMode ? 'border-white/10 text-stone-500' : 'border-stone-100 text-stone-500'}`}>
            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${isDarkMode ? 'border-stone-500' : 'border-stone-400'}`} />
              <span>Email is verified, then hashed. Nothing is stored.</span>
            </div>
            <div className="flex items-center space-x-3">
              <Lock className="w-3 h-3 shrink-0" />
              <span>Peers only see your randomized handle.</span>
            </div>
          </div>

          </div>
        </div>
      </section>
    </div>
  );
};
