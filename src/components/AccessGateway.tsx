import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { StudentSession } from '../types';
import { apiRequest } from '../utils/api';

interface AccessGatewayProps {
  onVerified: (session: StudentSession) => void;
  isDarkMode?: boolean;
}

export const AccessGateway: React.FC<AccessGatewayProps> = ({ onVerified }) => {
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
    <div className="flex min-h-full w-full overflow-y-auto bg-[#151515] font-sans text-white">
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

      <section className="flex w-full shrink-0 items-center justify-center bg-[#191919] px-4 py-6 sm:px-10 lg:w-[calc(50% - 1px)] xl:w-[496px]">
        <div className="w-full max-w-[430px]">
          <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.04em]">Verify your account</h1>
          <p className="mt-2 text-[13px] text-stone-400">Use your official Mapúa email to continue.</p>

          {config?.microsoftEnabled && <a className="mt-7 block rounded-none bg-[#e52329] px-4 py-3 text-center font-semibold text-white" href="/auth/microsoft/login">Sign in with Microsoft</a>}
          {config?.allowDemo && <form onSubmit={handleSubmit} className="mt-10 space-y-6">
            <div className="space-y-2">
              <label htmlFor="student-email" className="block text-[12px] font-bold uppercase tracking-wider text-[#ffe553]">Mapúa student email</label>
              <input id="student-email" autoComplete="email" maxLength={254} type="email" required value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                placeholder="username@mymail.mapua.edu.ph"
                className="w-full rounded-none border border-[#303030] bg-[#111] px-4 py-3 text-[14px] text-white outline-none placeholder:text-stone-600 focus:border-[#e52329]" />
              <p className="text-[10px] font-mono text-stone-500">Accepted: @mymail.mapua.edu.ph, @mymapua.edu.ph</p>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] font-mono text-stone-500">
                <span>Quick fill:</span>
                <button type="button" onClick={() => handleQuickFill('cardinal@mymail.mapua.edu.ph')} className="rounded-none border border-[#303030] bg-[#111] px-2 py-1 text-stone-300 hover:border-[#e52329]">@mymail.mapua.edu.ph</button>
                <button type="button" onClick={() => handleQuickFill('student@mymapua.edu.ph')} className="rounded-none border border-[#303030] bg-[#111] px-2 py-1 text-stone-300 hover:border-[#e52329]">@mymapua.edu.ph</button>
              </div>
            </div>

            {error && <div role="alert" className="flex items-start gap-3 border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
            <button type="submit" aria-label="Continue in demo mode" disabled={loading} className="mt-2 flex w-full items-center justify-center gap-2 rounded-none bg-[#e52329] py-4 text-[14px] font-bold uppercase tracking-wide text-white hover:bg-[#c91d23] disabled:opacity-50">
              <span>{loading ? 'Starting…' : 'Continue'}</span><ArrowRight className="h-4 w-4" />
            </button>
          </form>}
          {config && !config.allowDemo && !config.microsoftEnabled && <p role="alert" className="mt-8 text-sm text-red-400">Sign-in is unavailable. Contact the app administrator.</p>}
        </div>
      </section>
    </div>
  );
};
