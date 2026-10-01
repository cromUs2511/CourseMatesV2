import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, LogOut, RefreshCw, Shield, ShieldAlert } from 'lucide-react';
import { apiRequest } from '../utils/api';

type AdminReport = {
  id: string;
  reporter: string;
  target: string;
  category: 'harassment' | 'spam' | 'sexual' | 'threats' | 'other';
  ipAddress: string | null;
  createdAt: number;
  status: 'open' | 'resolved';
  actorBanned: boolean;
  ipBanned: boolean;
};
type AdminBan = {
  actor?: string;
  ipAddress?: string;
  createdAt: number;
  until: number | null;
};

const CATEGORY_LABELS: Record<AdminReport['category'], string> = {
  harassment: 'Harassment or bullying',
  spam: 'Spam or scams',
  sexual: 'Sexual content',
  threats: 'Threats or violence',
  other: 'Other rule violation',
};
const BAN_DURATIONS = [
  { label: '1 day', value: 86_400_000 },
  { label: '2 days', value: 172_800_000 },
  { label: '3 days', value: 259_200_000 },
  { label: 'Permanent', value: null },
] as const;

export function AdminDashboard({ isDarkMode }: { isDarkMode: boolean }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [bans, setBans] = useState<AdminBan[]>([]);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [duration, setDuration] = useState<(typeof BAN_DURATIONS)[number]['value']>(86_400_000);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ reports: AdminReport[]; bans: AdminBan[] }>(
        '/api/admin/reports',
      );
      setReports(data.reports);
      setBans(data.bans);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load reports.');
      if (loadError instanceof Error && loadError.message.includes('Administrator authentication'))
        setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    apiRequest<{ authenticated: boolean }>('/api/admin/session')
      .then((result) => {
        if (disposed) return;
        setAuthenticated(result.authenticated);
        setChecking(false);
      })
      .catch((sessionError) => {
        if (disposed) return;
        setError(sessionError instanceof Error ? sessionError.message : 'Unable to check sign-in.');
        setChecking(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadReports();
    const refresh = window.setInterval(() => void loadReports(), 60_000);
    return () => window.clearInterval(refresh);
  }, [authenticated, loadReports]);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/admin/login', { username, password });
      setPassword('');
      setAuthenticated(true);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
    }
  };

  const signOut = async () => {
    setError('');
    try {
      await apiRequest('/api/admin/logout', {});
      setAuthenticated(false);
      setReports([]);
      setBans([]);
      setNotice('You have signed out.');
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Unable to sign out.');
    }
  };

  const liftBan = async (ban: AdminBan) => {
    const id = ban.actor ?? ban.ipAddress;
    if (!id) return;
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/admin/moderate', {
        action: ban.ipAddress ? 'unbanIp' : 'unban',
        actor: ban.actor,
        ipAddress: ban.ipAddress,
      });
      setNotice(ban.ipAddress ? 'IP restriction lifted.' : 'Browser restriction lifted.');
      await loadReports();
    } catch (moderationError) {
      setError(moderationError instanceof Error ? moderationError.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const moderate = async (
    report: AdminReport,
    action: 'resolve' | 'ban' | 'unban' | 'unbanIp',
    includeIp = false,
  ) => {
    setBusyId(report.id);
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/admin/moderate', {
        action,
        reportId: report.id,
        actor: report.target,
        ipAddress: report.ipAddress,
        ...(action === 'ban' ? { durationMs: duration, includeIp } : {}),
      });
      setNotice(
        action === 'resolve'
          ? 'Report marked resolved.'
          : action === 'ban'
            ? includeIp
              ? 'Browser and IP restrictions applied.'
              : 'Browser restriction applied.'
            : action === 'unbanIp'
              ? 'IP restriction lifted.'
              : 'Browser restriction lifted.',
      );
      await loadReports();
    } catch (moderationError) {
      setError(moderationError instanceof Error ? moderationError.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const surface = isDarkMode
    ? 'border-stone-800 bg-[#1a1917] text-stone-100'
    : 'border-stone-200 bg-white text-stone-900';

  if (checking) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#141312] text-stone-100">
        Checking administrator access…
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main
        className={`grid min-h-[100dvh] place-items-center px-4 py-8 ${isDarkMode ? 'bg-[#141312]' : 'bg-[#FAF8F5]'}`}
      >
        <section className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl sm:p-8 ${surface}`}>
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-emerald-500"
          >
            <ArrowLeft className="h-4 w-4" /> CourseMates
          </a>
          <div className="mb-6 mt-8 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-500">
                Private access
              </p>
              <h1 className="text-2xl font-bold">Admin sign in</h1>
            </div>
          </div>
          <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
            Use the administrator credentials configured for this service.
          </p>
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mb-4 text-sm text-emerald-500">
              {notice}
            </p>
          )}
          <form onSubmit={(event) => void signIn(event)} className="space-y-4">
            <label className="block text-sm font-semibold">
              Username
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-transparent px-3 py-3 font-normal outline-none focus:border-emerald-500 dark:border-stone-700"
              />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-transparent px-3 py-3 font-normal outline-none focus:border-emerald-500 dark:border-stone-700"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-500"
            >
              Sign in
            </button>
          </form>
        </section>
      </main>
    );
  }

  const visibleReports = reports.filter((report) => filter === 'all' || report.status === filter);
  const openCount = reports.filter((report) => report.status === 'open').length;

  return (
    <main
      className={`min-h-[100dvh] overflow-y-auto ${isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-900'}`}
    >
      <header className="sticky top-0 z-10 border-b border-stone-200/70 bg-[#FAF8F5]/90 backdrop-blur-xl dark:border-stone-800 dark:bg-[#141312]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a href="/" className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <Shield className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.15em] text-emerald-500">
                CourseMates
              </span>
              <span className="block font-bold">Moderation</span>
            </span>
          </a>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void loadReports()}
              disabled={loading}
              aria-label="Refresh reports"
              className="rounded-lg border border-stone-300 p-2.5 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-9">
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-500">
              Administrator
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Report review</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-500 dark:text-stone-400">
              Review reports, apply time-limited access restrictions, or permanently restrict a
              browser identity and its reported IP.
            </p>
          </div>
          <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${surface}`}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/10 text-amber-500">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-xs text-stone-500 dark:text-stone-400">Open reports</span>
              <strong className="text-xl">{openCount}</strong>
            </span>
          </div>
        </section>
        <aside className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-stone-600 dark:text-stone-300">
          IP addresses are private personal data. Use them only for safety review and restrictions.
          Report metadata and IPs are retained for up to 30 days; permanent bans remain until
          manually lifted. IP restrictions can affect people sharing a network and may not identify
          one person reliably.
        </aside>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-300"
          >
            {notice}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Report status filter"
            className="inline-flex rounded-lg border border-stone-300 p-1 dark:border-stone-700"
          >
            {(['open', 'resolved', 'all'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={filter === item}
                onClick={() => setFilter(item)}
                className={`rounded-md px-3 py-2 text-sm font-semibold capitalize ${filter === item ? 'bg-emerald-600 text-white' : 'text-stone-500 hover:text-stone-900 dark:hover:text-white'}`}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
            Restriction duration
            <select
              value={duration === null ? 'permanent' : String(duration)}
              onChange={(event) =>
                setDuration(
                  event.target.value === 'permanent'
                    ? null
                    : (Number(event.target.value) as 86_400_000 | 172_800_000 | 259_200_000),
                )
              }
              style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
              className="rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-stone-900 dark:border-stone-700 dark:text-stone-100"
            >
              {BAN_DURATIONS.map((item) => (
                <option
                  key={item.label}
                  value={item.value ?? 'permanent'}
                  style={{
                    backgroundColor: isDarkMode ? '#1a1917' : '#ffffff',
                    color: isDarkMode ? '#f5f5f4' : '#1c1917',
                  }}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <section aria-label="Reports" className="space-y-3">
          {loading && reports.length === 0 ? (
            <p role="status" className="py-12 text-center text-sm text-stone-500">
              Loading reports…
            </p>
          ) : visibleReports.length === 0 ? (
            <div className={`rounded-2xl border px-5 py-12 text-center ${surface}`}>
              <Check className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-3 font-semibold">
                {filter === 'open' ? 'No open reports' : 'No reports in this view'}
              </p>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                New submissions will appear here automatically.
              </p>
            </div>
          ) : (
            visibleReports.map((report) => (
              <article
                key={report.id}
                className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${surface}`}
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold text-red-500">
                        {CATEGORY_LABELS[report.category]}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${report.status === 'open' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}
                      >
                        {report.status}
                      </span>
                      {report.actorBanned && (
                        <span className="rounded-full bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-500">
                          Browser restricted
                        </span>
                      )}
                      {report.ipBanned && (
                        <span className="rounded-full bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-500">
                          IP restricted
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
                      {new Date(report.createdAt).toLocaleString()}
                    </p>
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-stone-500">Reported browser ID</dt>
                        <dd className="mt-0.5 break-all font-mono">{report.target}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-stone-500">Reported IP</dt>
                        <dd className="mt-0.5 break-all font-mono">
                          {report.ipAddress ?? 'Unavailable'}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-stone-500">Reporter ID</dt>
                        <dd className="mt-0.5 break-all font-mono">{report.reporter}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-stone-500">
                      No message text or media is attached to this report.
                    </p>
                  </div>
                  <div className="flex flex-wrap content-start gap-2 lg:max-w-[300px] lg:justify-end">
                    {!report.actorBanned ? (
                      <>
                        <button
                          type="button"
                          disabled={busyId === report.id}
                          onClick={() => void moderate(report, 'ban')}
                          className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                          Restrict browser
                        </button>
                        <button
                          type="button"
                          disabled={busyId === report.id || !report.ipAddress}
                          onClick={() => void moderate(report, 'ban', true)}
                          className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                          Restrict browser + IP
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => void moderate(report, 'unban')}
                        className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold dark:border-stone-700"
                      >
                        Lift browser restriction
                      </button>
                    )}
                    {report.ipBanned && (
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => void moderate(report, 'unbanIp')}
                        className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold dark:border-stone-700"
                      >
                        Lift IP restriction
                      </button>
                    )}
                    {report.status === 'open' && (
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => void moderate(report, 'resolve')}
                        className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold dark:border-stone-700"
                      >
                        Resolve report
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
        <section aria-label="Active restrictions" className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">Active restrictions</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Permanent restrictions remain listed here until lifted, even after their source report
              expires.
            </p>
          </div>
          {bans.length === 0 ? (
            <div className={`rounded-xl border px-4 py-5 text-sm text-stone-500 ${surface}`}>
              No active restrictions.
            </div>
          ) : (
            bans.map((ban) => {
              const id = ban.actor ?? ban.ipAddress!;
              return (
                <article
                  key={`${ban.actor ?? 'ip'}:${ban.ipAddress ?? 'actor'}:${ban.createdAt}`}
                  className={`flex flex-col justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${surface}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {ban.ipAddress ? 'IP address restriction' : 'Browser identity restriction'}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-stone-500 dark:text-stone-400">
                      {ban.ipAddress ?? ban.actor}
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      {ban.until === null
                        ? 'Permanent'
                        : `Expires ${new Date(ban.until).toLocaleString()}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === id}
                    onClick={() => void liftBan(ban)}
                    className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                  >
                    Lift restriction
                  </button>
                </article>
              );
            })
          )}
        </section>
        <p className="pb-4 text-center text-xs text-stone-500 dark:text-stone-400">
          Access and decisions should be limited to trusted moderators. Reports are not emergency
          response.
        </p>
      </div>
    </main>
  );
}
