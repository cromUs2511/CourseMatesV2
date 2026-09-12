import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
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
  const [acceptedTerms, setAcceptedTerms] = useState(false);
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
    if (submitting.current || !config?.allowDemo || !acceptedTerms) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest('/api/auth/school-email', undefined, {
        email: `member-${crypto.randomUUID()}@anonymous.coursemates.ph`,
        interests: [],
      });
      onVerified(data.session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

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

      <section className={`access-form-panel relative my-auto flex w-full max-w-[500px] shrink-0 flex-col items-center rounded-2xl border px-6 py-6 shadow-[0_16px_48px_rgba(0,0,0,0.16)] sm:px-8 sm:py-7 ${
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
          <h1 className={`text-[28px] font-semibold leading-tight tracking-[-0.03em] ${isDarkMode ? 'text-white' : 'text-stone-950'}`}>Welcome to CourseMates</h1>
          <p className={`mt-2 text-sm leading-5 ${isDarkMode ? 'text-stone-300' : 'text-stone-700'}`}>
            CourseMates is an exclusive online community for college and university students in the Philippines (18+). It’s a space to connect, share experiences, collaborate on academics, and make friends.
          </p>

          <section aria-labelledby="terms-title" className={`mt-4 rounded-xl border p-4 text-xs leading-5 ${
            isDarkMode ? 'border-stone-700 bg-black/20 text-stone-300' : 'border-stone-300 bg-stone-50 text-stone-700'
          }`}>
            <h2 id="terms-title" className={`font-semibold ${isDarkMode ? 'text-white' : 'text-stone-950'}`}>Terms &amp; Conditions</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>Age:</strong> You must be at least 18 years old.</li>
              <li><strong>Conduct:</strong> You are fully responsible for your messages. No harassment, illegal content, or impersonation is allowed.</li>
              <li><strong>Enforcement:</strong> We reserve the right to ban users who break these rules.</li>
            </ul>
            <h2 className={`mt-3 font-semibold ${isDarkMode ? 'text-white' : 'text-stone-950'}`}>Disclaimer</h2>
            <p className="mt-1">CourseMates is provided “as is” without warranties. You use the platform entirely at your own risk, and we are not liable for any damages related to your use of the site.</p>
          </section>

            {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
          {config?.allowDemo && <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5 ${
              isDarkMode ? 'border-stone-700 bg-white/[0.03] text-stone-200' : 'border-stone-300 bg-white text-stone-800'
            }`}>
              <input type="checkbox" checked={acceptedTerms} onChange={event => { setAcceptedTerms(event.target.checked); if (error) setError(null); }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#e52329]" />
              <span>I confirm that I am at least 18 years old and agree to the Terms &amp; Conditions and Disclaimer.</span>
            </label>

            <button type="submit" aria-label="Continue to CourseMates" disabled={loading || !acceptedTerms} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e52329] text-sm font-semibold text-white hover:bg-[#c91d23] disabled:cursor-not-allowed disabled:opacity-40">
              <span>{loading ? 'Starting…' : 'Continue'}</span><ArrowRight className="h-4 w-4" />
            </button>
          </form>}
          {config && !config.allowDemo && <p role="alert" className={`mt-8 text-sm ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>Community access is unavailable. Contact the app administrator.</p>}
        </div>
      </section>
    </div>
  );
};
