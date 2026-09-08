import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, AlertTriangle, Moon, Sun } from 'lucide-react';
import { StudentSession } from '../types';
import { apiRequest } from '../utils/api';

interface AccessGatewayProps {
  onVerified: (session: StudentSession) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export const AccessGateway: React.FC<AccessGatewayProps> = ({ onVerified, isDarkMode, onToggleDarkMode }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<{ microsoftEnabled: boolean; allowDemo: boolean } | null>(null);
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).get('auth_error'));
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/api/auth/config', undefined, undefined, controller.signal).then(setConfig)
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    if (location.search.includes('auth_error=')) history.replaceState(null, '', location.pathname);
    return () => controller.abort();
  }, []);

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (submitting.current || !config?.allowDemo) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest('/api/auth/school-email', undefined, {
        email: email.trim().toLowerCase(), interests: [],
      });
      onVerified(data.session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const handleQuickFill = (value: string) => { setEmail(value); setError(null); };

  return (
    <div className={`access-gateway ${isDarkMode ? 'access-gateway-dark text-white' : 'access-gateway-light text-stone-900'} relative flex min-h-full w-full overflow-y-auto font-sans`}>
      <button
        type="button"
        onClick={onToggleDarkMode}
        aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        className={`access-mobile-theme-toggle absolute right-4 top-4 z-10 border p-2.5 transition-colors lg:hidden ${
          isDarkMode
            ? 'border-stone-700 bg-[#191919] text-amber-300 hover:bg-stone-800'
            : 'border-stone-300 bg-white/90 text-stone-700 hover:bg-white'
        }`}
      >
        {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <section
        className="relative hidden min-h-full flex-1 overflow-hidden lg:flex"
        style={{
          backgroundColor: '#111',
          backgroundImage: 'linear-gradient(rgba(229, 164, 0, 0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(229, 164, 0, 0.13) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      >
        <div className="relative m-auto flex items-center justify-center px-8">
          <div className="absolute -left-12 text-7xl font-light text-stone-700/80">&lt;</div>
          <div className="absolute -right-12 text-7xl font-light text-stone-700/80">&gt;</div>
          <div className="text-center font-serif font-black leading-[0.82] tracking-[-0.08em]">
            <div className="text-[clamp(5rem,11vw,10rem)] text-[#b51d24]">Course</div>
            <div className="text-[clamp(5rem,11vw,10rem)] text-[#e88900]">Mates</div>
          </div>
        </div>
      </section>

      <section className={`access-form-panel flex w-full shrink-0 flex-col items-center justify-start px-4 pt-8 sm:px-10 lg:justify-center lg:py-6 lg:w-[calc(50% - 1px)] xl:w-[496px] ${isDarkMode ? 'bg-[#191919]' : 'bg-[#f7f4ef]'}`}>
        <div className="access-mobile-logo mb-14 text-center font-serif font-black leading-[0.82] tracking-[-0.08em] lg:hidden" aria-label="CourseMates">
          <div className="text-[clamp(4rem,20vw,5.5rem)] text-[#b51d24]">Course</div>
          <div className="text-[clamp(4rem,20vw,5.5rem)] text-[#e88900]">Mates</div>
        </div>
        <div className="w-full max-w-[430px]">
          <h1 className={`text-[30px] font-extrabold leading-tight tracking-[-0.04em] ${isDarkMode ? 'text-white' : 'text-stone-950'}`}>Verify your account</h1>
          <p className={`mt-2 text-[13px] ${isDarkMode ? 'text-stone-400' : 'text-stone-600'}`}>Use your official Mapúa email to continue.</p>

          {config?.microsoftEnabled && <a className="mt-7 block rounded-none bg-[#e52329] px-4 py-3 text-center font-semibold text-white" href="/auth/microsoft/login">Sign in with Microsoft</a>}
          {config?.allowDemo && <form onSubmit={handleSubmit} className="mt-10 space-y-6">
            <div className="space-y-2">
              <label htmlFor="student-email" className={`block text-[12px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-[#ffe553]' : 'text-[#8a6500]'}`}>Mapúa student email</label>
              <input id="student-email" autoComplete="email" maxLength={254} type="email" required value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                placeholder="username@mymail.mapua.edu.ph"
                className={`w-full rounded-none border px-4 py-3 text-[14px] outline-none focus:border-[#e52329] ${isDarkMode ? 'border-[#303030] bg-[#111] text-white placeholder:text-stone-600' : 'border-stone-300 bg-white text-stone-900 placeholder:text-stone-400'}`} />
              <p className={`text-[10px] font-mono ${isDarkMode ? 'text-stone-500' : 'text-stone-600'}`}>Accepted: @mymail.mapua.edu.ph, @mymapua.edu.ph</p>
              <div className={`flex flex-wrap items-center gap-2 pt-1 text-[10px] font-mono ${isDarkMode ? 'text-stone-500' : 'text-stone-600'}`}>
                <span>Quick fill:</span>
                <button type="button" onClick={() => handleQuickFill('cardinal@mymail.mapua.edu.ph')} className={`rounded-none border px-2 py-1 hover:border-[#e52329] ${isDarkMode ? 'border-[#303030] bg-[#111] text-stone-300' : 'border-stone-300 bg-white text-stone-700'}`}>@mymail.mapua.edu.ph</button>
                <button type="button" onClick={() => handleQuickFill('student@mymapua.edu.ph')} className={`rounded-none border px-2 py-1 hover:border-[#e52329] ${isDarkMode ? 'border-[#303030] bg-[#111] text-stone-300' : 'border-stone-300 bg-white text-stone-700'}`}>@mymapua.edu.ph</button>
              </div>
            </div>

            {error && <div role="alert" className={`flex items-start gap-3 border p-3 text-xs ${isDarkMode ? 'border-red-900/60 bg-red-950/30 text-red-300' : 'border-red-300 bg-red-50 text-red-800'}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
            <button type="submit" aria-label="Continue in demo mode" disabled={loading} className="mt-2 flex w-full items-center justify-center gap-2 rounded-none bg-[#e52329] py-4 text-[14px] font-bold uppercase tracking-wide text-white hover:bg-[#c91d23] disabled:opacity-50">
              <span>{loading ? 'Starting…' : 'Continue'}</span><ArrowRight className="h-4 w-4" />
            </button>
          </form>}
          {config && !config.allowDemo && !config.microsoftEnabled && <p role="alert" className={`mt-8 text-sm ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>Sign-in is unavailable. Contact the app administrator.</p>}
        </div>
      </section>
    </div>
  );
};
