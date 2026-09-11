import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, AlertTriangle, Mail } from 'lucide-react';
import { StudentSession } from '../types';
import { apiRequest } from '../utils/api';
import { ThemeToggle } from './ThemeToggle';
import { SoundToggle } from './SoundToggle';

interface AccessGatewayProps {
  onVerified: (session: StudentSession) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  isSoundEnabled: boolean;
  onToggleSound: () => void;
}

export const AccessGateway: React.FC<AccessGatewayProps> = ({ onVerified, isDarkMode, onToggleDarkMode, isSoundEnabled, onToggleSound }) => {
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
    <div className={`access-gateway relative flex min-h-full w-full flex-col items-center gap-8 overflow-y-auto px-5 py-16 font-sans antialiased lg:flex-row lg:justify-center lg:gap-8 lg:px-10 lg:py-10 ${
      isDarkMode ? 'access-gateway-dark bg-[#101010] text-white' : 'access-gateway-light bg-[#f7f4ef] text-stone-900'
    }`}>
      <section className="access-desktop-logo hidden min-w-0 w-full max-w-[760px] shrink lg:block" aria-label="CourseMates">
        <div className="flex items-center justify-center gap-3">
          <span aria-hidden="true" className="text-7xl font-light text-stone-500/80">&lt;</span>
          <div className="access-logo-type text-center font-serif font-black leading-[0.82] tracking-[-0.08em]">
            <div className="text-[#c51e2b]">Course</div>
            <div className="text-[#f2a400]">Mates</div>
          </div>
          <span aria-hidden="true" className="text-7xl font-light text-stone-500/80">&gt;</span>
        </div>
      </section>

      <section className={`access-form-panel relative my-auto flex w-full max-w-[480px] shrink-0 flex-col items-center rounded-2xl border px-6 py-8 shadow-[0_16px_48px_rgba(0,0,0,0.16)] sm:px-10 sm:py-10 ${
        isDarkMode ? 'border-white/10 bg-[#191919]' : 'border-stone-300 bg-white'
      }`}>
        <div className="access-mobile-logo mb-8 w-[calc(100%+2rem)] lg:hidden" aria-label="CourseMates">
          <div className="mb-3 flex justify-end pr-1">
            <div className="flex items-center gap-2">
              <SoundToggle isEnabled={isSoundEnabled} onToggle={onToggleSound} />
              <ThemeToggle isDarkMode={isDarkMode} onToggle={onToggleDarkMode} compact />
            </div>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span aria-hidden="true" className="text-3xl font-light text-stone-500/80">&lt;</span>
            <div className="access-logo-type text-center font-serif font-black leading-[0.82] tracking-[-0.08em]">
              <div className="text-[#c51e2b]">Course</div>
              <div className="text-[#f2a400]">Mates</div>
            </div>
            <span aria-hidden="true" className="text-3xl font-light text-stone-500/80">&gt;</span>
          </div>
        </div>
        <div className="access-desktop-theme-toggle absolute right-6 top-6 z-20 hidden lg:block">
          <ThemeToggle isDarkMode={isDarkMode} onToggle={onToggleDarkMode} />
        </div>
        <div className="w-full max-w-[430px]">
          <h1 className={`text-[28px] font-semibold leading-tight tracking-[-0.03em] ${isDarkMode ? 'text-white' : 'text-stone-950'}`}>Verify your account</h1>
          <p className={`mt-2 text-sm leading-6 ${isDarkMode ? 'text-stone-400' : 'text-stone-600'}`}>Enter your email address to continue.</p>

          {config?.microsoftEnabled && <a className="mt-7 block rounded-xl bg-[#e52329] px-4 py-3 text-center font-semibold text-white" href="/auth/microsoft/login">Sign in with Microsoft</a>}
            {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
          {config?.allowDemo && <form onSubmit={handleSubmit} className="mt-7 space-y-6">
            <div className="space-y-2">
              <label htmlFor="student-email" className="block text-xs font-semibold uppercase tracking-[0.08em] text-[#f2c52f]">Email address</label>
              <div className="relative">
                <Mail className={`pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 ${
                  isDarkMode ? 'text-stone-300' : 'text-stone-500'
                }`} />
                <input id="student-email" autoComplete="email" maxLength={254} type="email" required value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                placeholder="you@gmail.com" aria-describedby="student-email-help"
                className={`h-12 w-full min-w-0 rounded-xl border pl-11 pr-3 text-base outline-none transition-colors placeholder:text-sm focus:border-[#e52329] focus:ring-2 focus:ring-[#e52329]/20 ${
                  isDarkMode ? 'border-stone-600 bg-[#141414] text-white placeholder:text-stone-400' : 'border-stone-300 bg-white text-stone-900 placeholder:text-stone-400'
                }`} />
              </div>
              <p id="student-email-help" className="text-xs leading-5 text-stone-400">Use any valid email address for demo access.</p>
              <div className={`flex flex-wrap items-center gap-2 pt-3 text-xs ${
                isDarkMode ? 'text-stone-400' : 'text-stone-600'
              }`}>
                <span className="w-full">Quick fill:</span>
                <button type="button" onClick={() => handleQuickFill('student@gmail.com')} className={`min-h-10 rounded-lg border px-3 py-2 hover:border-[#e52329] ${
                  isDarkMode ? 'border-stone-700 bg-white/[0.04] text-stone-100' : 'border-stone-400 bg-stone-50 text-stone-800'
                }`}>student@gmail.com</button>
              </div>
            </div>

            <button type="submit" aria-label="Continue in demo mode" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e52329] text-sm font-semibold text-white hover:bg-[#c91d23] disabled:opacity-50">
              <span>{loading ? 'Starting…' : 'Continue'}</span><ArrowRight className="h-4 w-4" />
            </button>
          </form>}
          {config && !config.allowDemo && !config.microsoftEnabled && <p role="alert" className={`mt-8 text-sm ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>Sign-in is unavailable. Contact the app administrator.</p>}
        </div>
      </section>
    </div>
  );
};
