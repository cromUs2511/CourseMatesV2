import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  History,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  X,
} from 'lucide-react';
import { apiRequest } from '../utils/api';

type ReportStatus = 'open' | 'resolved' | 'dismissed' | 'escalated';
type AdminReport = {
  id: string;
  reporter: string;
  target: string;
  category: 'harassment' | 'spam' | 'sexual' | 'threats' | 'other';
  ipAddress: string | null;
  createdAt: number;
  status: ReportStatus;
  roomId?: string;
  topic?: string;
  reason?: string;
  reporterHandle?: string;
  targetHandle?: string;
  updatedAt?: number;
  adminNote?: string;
  actorBanned: boolean;
  ipBanned: boolean;
  messageCount?: number;
  hasContext?: boolean;
};
type AdminBan = {
  actor?: string;
  ipAddress?: string;
  createdAt: number;
  until: number | null;
};
type ContextMessage = {
  messageId: string;
  senderRole: 'reporter' | 'target' | 'system';
  senderHandle: string;
  text: string;
  createdAt: number;
};
type ReportDetail = {
  report: AdminReport;
  context: {
    meta: {
      roomId: string | null;
      topic: string | null;
      reporterHandle: string | null;
      targetHandle: string | null;
      createdAt: number;
    } | null;
    messages: ContextMessage[];
  };
  actions: Array<{
    id: number;
    createdAt: number;
    admin: string;
    action: string;
    reportId: string | null;
    detail: string | null;
  }>;
};

const CATEGORY_LABELS: Record<AdminReport['category'], string> = {
  harassment: 'Harassment or bullying',
  spam: 'Spam or scams',
  sexual: 'Sexual content',
  threats: 'Threats or violence',
  other: 'Other rule violation',
};
const STATUS_LABELS: Record<ReportStatus | 'all', string> = {
  open: 'Open',
  escalated: 'Escalated',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  all: 'All',
};
const BAN_DURATIONS = [
  { label: '1 day', value: 86_400_000 },
  { label: '2 days', value: 172_800_000 },
  { label: '3 days', value: 259_200_000 },
  { label: 'Permanent', value: null },
] as const;
type StatusAction = 'resolve' | 'dismiss' | 'escalate' | 'ban' | 'unban' | 'unbanIp';

function statusStyles(status: ReportStatus): string {
  if (status === 'open') return 'bg-amber-500/10 text-amber-600 dark:text-amber-300';
  if (status === 'escalated') return 'bg-purple-500/10 text-purple-600 dark:text-purple-300';
  if (status === 'dismissed') return 'bg-stone-500/10 text-stone-500 dark:text-stone-400';
  return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
}

export function AdminDashboard({ isDarkMode }: { isDarkMode: boolean }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [bans, setBans] = useState<AdminBan[]>([]);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('open');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [duration, setDuration] = useState<(typeof BAN_DURATIONS)[number]['value']>(86_400_000);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const durationMenuRef = useRef<HTMLDivElement>(null);
  const durationButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [note, setNote] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<{
    action: StatusAction;
    includeIp?: boolean;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reviewButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

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

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    setNote('');
    setPendingConfirm(null);
    try {
      const data = await apiRequest<ReportDetail>('/api/admin/reports/' + encodeURIComponent(id));
      setDetail(data);
      setNote(data.report.adminNote ?? '');
    } catch (detailFetchError) {
      setDetailError(
        detailFetchError instanceof Error ? detailFetchError.message : 'Unable to open report.',
      );
    } finally {
      setDetailLoading(false);
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

  const closeDetail = useCallback(() => {
    setSelectedId((current) => {
      if (current) {
        const trigger = reviewButtonRefs.current.get(current);
        window.setTimeout(() => trigger?.focus(), 30);
      }
      return null;
    });
    setDetail(null);
    setDetailError('');
    setPendingConfirm(null);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Focus the dialog when it opens; return focus to the Review button on close.
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingConfirm) closeDetail();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [selectedId, pendingConfirm, closeDetail]);

  useEffect(() => {
    if (pendingConfirm) confirmButtonRef.current?.focus();
  }, [pendingConfirm]);

  useEffect(() => {
    if (!durationMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!durationMenuRef.current?.contains(event.target as Node)) {
        setDurationMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDurationMenuOpen(false);
        durationButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [durationMenuOpen]);

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

  const moderate = async (report: AdminReport, action: StatusAction, includeIp = false) => {
    setBusyId(report.id + action + String(includeIp));
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/admin/moderate', {
        action,
        reportId: report.id,
        actor: report.target,
        ipAddress: report.ipAddress,
        ...(action === 'ban' ? { durationMs: duration, includeIp } : {}),
        ...(note.trim() && (action === 'resolve' || action === 'dismiss' || action === 'escalate')
          ? { note: note.trim().slice(0, 1000) }
          : {}),
      });
      const messages: Record<StatusAction, string> = {
        resolve: 'Report marked resolved.',
        dismiss: 'Report dismissed.',
        escalate: 'Report escalated for further review.',
        ban: includeIp ? 'Browser and IP restrictions applied.' : 'Browser restriction applied.',
        unban: 'Browser restriction lifted.',
        unbanIp: 'IP restriction lifted.',
      };
      setNotice(messages[action]);
      setPendingConfirm(null);
      await loadReports();
      if (selectedId === report.id) await loadDetail(report.id);
      else if (action === 'resolve' || action === 'dismiss' || action === 'escalate') {
        // Status-changing actions from the list keep the admin in context.
      }
      if (action === 'resolve' || action === 'dismiss' || action === 'escalate') closeDetail();
    } catch (moderationError) {
      setError(moderationError instanceof Error ? moderationError.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const surface = isDarkMode
    ? 'border-stone-800 bg-[#1a1917] text-stone-100'
    : 'border-stone-200 bg-white text-stone-900';

  const counts = useMemo(() => {
    const open = reports.filter((r) => r.status === 'open').length;
    const escalated = reports.filter((r) => r.status === 'escalated').length;
    const resolved = reports.filter((r) => r.status === 'resolved').length;
    const dismissed = reports.filter((r) => r.status === 'dismissed').length;
    return { open, escalated, resolved, dismissed, total: reports.length };
  }, [reports]);

  const visibleReports = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reports
      .filter((report) => filter === 'all' || report.status === filter)
      .filter((report) => categoryFilter === 'all' || report.category === categoryFilter)
      .filter((report) => {
        if (!needle) return true;
        const haystack = [
          report.reason ?? '',
          report.topic ?? '',
          report.reporterHandle ?? '',
          report.targetHandle ?? '',
          report.reporter,
          report.target,
          report.ipAddress ?? '',
          report.id,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [reports, filter, categoryFilter, query]);

  if (checking) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#141312] text-stone-100">
        <p role="status">Checking administrator access…</p>
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
            <label className="block text-sm font-semibold" htmlFor="admin-username">
              Username
            </label>
            <input
              id="admin-username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-transparent px-3 py-3 font-normal outline-none focus:border-emerald-500 dark:border-stone-700"
            />
            <label className="block text-sm font-semibold" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-transparent px-3 py-3 font-normal outline-none focus:border-emerald-500 dark:border-stone-700"
            />
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

  const activeReport = detail?.report ?? reports.find((r) => r.id === selectedId) ?? null;

  return (
    <main
      className={`min-h-[100dvh] overflow-y-auto ${isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-900'}`}
    >
      <header className="sticky top-0 z-10 border-b border-stone-200/70 bg-[#FAF8F5]/90 backdrop-blur-xl dark:border-stone-800 dark:bg-[#141312]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a href="/" className="flex min-w-0 items-center gap-3" aria-label="Back to CourseMates">
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
              Open a report to read the reported conversation with surrounding context, then
              resolve, dismiss, or escalate it. Restrictions apply to a browser identity and,
              optionally, its reported IP.
            </p>
          </div>
        </section>

        <section aria-label="Moderation overview" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: 'Open', value: counts.open },
            { label: 'Escalated', value: counts.escalated },
            { label: 'Resolved', value: counts.resolved },
            { label: 'Dismissed', value: counts.dismissed },
            { label: 'Total', value: counts.total },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-xl border px-4 py-3 ${surface}`}>
              <p className="text-xs text-stone-500 dark:text-stone-400">{stat.label}</p>
              <p className="text-2xl font-bold" aria-label={`${stat.label} reports: ${stat.value}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </section>

        <aside className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-stone-600 dark:text-stone-300">
          IP addresses are private personal data. Use them only for safety review and restrictions.
          Reports, conversation excerpts, and admin decisions persist in the moderation database and
          are retained for up to 30 days; permanent bans remain until manually lifted. IP
          restrictions can affect people sharing a network and may not identify one person reliably.
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

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="tablist"
            aria-label="Report status filter"
            className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-stone-300 p-1 dark:border-stone-700"
          >
            {(['open', 'escalated', 'resolved', 'dismissed', 'all'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={filter === item}
                onClick={() => setFilter(item)}
                className={`rounded-md px-3 py-2 text-sm font-semibold capitalize ${filter === item ? 'bg-emerald-600 text-white' : 'text-stone-500 hover:text-stone-900 dark:hover:text-white'}`}
              >
                {STATUS_LABELS[item]}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block sm:w-64">
              <span className="sr-only">Search reports</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search handle, topic, reason, IP…"
                aria-label="Search reports"
                className="w-full rounded-lg border border-stone-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 dark:border-stone-700"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Filter by category</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label="Filter by category"
                className="rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-stone-700"
              >
                <option value="all">All reasons</option>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
              <span id="restriction-duration-label">Restriction</span>
              <div ref={durationMenuRef} className="relative">
                <button
                  ref={durationButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={durationMenuOpen}
                  aria-controls="restriction-duration-menu"
                  aria-labelledby="restriction-duration-label"
                  onClick={() => setDurationMenuOpen((open) => !open)}
                  className="inline-flex min-w-32 items-center justify-between gap-3 rounded-lg border border-stone-300 bg-white px-3 py-2 text-left font-medium text-stone-900 hover:bg-stone-100 dark:border-stone-700 dark:bg-[#1a1917] dark:text-stone-100 dark:hover:bg-stone-800"
                >
                  {BAN_DURATIONS.find((item) => item.value === duration)?.label}
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${durationMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {durationMenuOpen && (
                  <div
                    id="restriction-duration-menu"
                    role="menu"
                    aria-label="Restriction duration"
                    className={`absolute right-0 z-20 mt-1 min-w-full overflow-hidden rounded-lg border p-1 shadow-xl ${
                      isDarkMode
                        ? 'border-stone-700 bg-[#1a1917] text-stone-100'
                        : 'border-stone-200 bg-white text-stone-900'
                    }`}
                  >
                    {BAN_DURATIONS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitemradio"
                        aria-checked={duration === item.value}
                        onClick={() => {
                          setDuration(item.value);
                          setDurationMenuOpen(false);
                        }}
                        className={`block w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium ${
                          duration === item.value
                            ? 'bg-emerald-600 text-white'
                            : isDarkMode
                              ? 'text-stone-100 hover:bg-stone-800'
                              : 'text-stone-900 hover:bg-stone-100'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
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
                {filter === 'open' && !query ? 'No open reports' : 'No reports match these filters'}
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
                        className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${statusStyles(report.status)}`}
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
                      {(report.messageCount ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-600 dark:text-sky-300">
                          <MessageSquareText className="h-3 w-3" aria-hidden="true" />
                          {report.messageCount} messages
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm font-semibold">
                      {report.topic ?? 'General Peer Discovery'}
                      {report.targetHandle ? ` · involving ${report.targetHandle}` : ''}
                    </p>
                    {report.reason && (
                      <p className="mt-1 line-clamp-2 text-sm text-stone-600 dark:text-stone-300">
                        “{report.reason}”
                      </p>
                    )}
                    <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                      Reported {new Date(report.createdAt).toLocaleString()}
                      {report.updatedAt && report.updatedAt !== report.createdAt
                        ? ` · updated ${new Date(report.updatedAt).toLocaleString()}`
                        : ''}
                    </p>
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-stone-500">Reported person</dt>
                        <dd className="mt-0.5 break-all font-mono">
                          {report.targetHandle ?? report.target}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-stone-500">Reporter</dt>
                        <dd className="mt-0.5 break-all font-mono">
                          {report.reporterHandle ?? report.reporter}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap content-start gap-2 lg:max-w-[320px] lg:justify-end">
                    <button
                      ref={(node) => {
                        if (node) reviewButtonRefs.current.set(report.id, node);
                        else reviewButtonRefs.current.delete(report.id);
                      }}
                      type="button"
                      onClick={() => setSelectedId(report.id)}
                      aria-haspopup="dialog"
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      Review conversation
                    </button>
                    {report.status === 'open' && (
                      <button
                        type="button"
                        disabled={busyId?.startsWith(report.id)}
                        onClick={() => void moderate(report, 'resolve')}
                        className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                      >
                        Resolve
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
                    aria-label={`Lift restriction for ${ban.ipAddress ?? ban.actor}`}
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

      {selectedId && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget && !pendingConfirm) closeDetail();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-detail-title"
            tabIndex={-1}
            className={`flex max-h-[95dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border shadow-2xl outline-none sm:rounded-2xl ${surface}`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800 sm:px-6">
              <h2 id="report-detail-title" className="truncate text-base font-bold sm:text-lg">
                {activeReport
                  ? `${CATEGORY_LABELS[activeReport.category]} · ${activeReport.status}`
                  : 'Report detail'}
              </h2>
              <button
                type="button"
                onClick={closeDetail}
                aria-label="Close report detail"
                className="rounded-lg border border-stone-300 p-2 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {detailLoading && (
                <p role="status" className="py-10 text-center text-sm text-stone-500">
                  Loading conversation…
                </p>
              )}
              {detailError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"
                >
                  {detailError}
                </p>
              )}
              {detail && (
                <div className="space-y-6">
                  <section aria-label="Report details" className="space-y-2 text-sm">
                    <dl className="grid gap-3 rounded-xl border border-stone-200 p-4 text-xs dark:border-stone-800 sm:grid-cols-2 sm:text-sm">
                      <div>
                        <dt className="font-semibold text-stone-500">Reason</dt>
                        <dd className="mt-1">
                          {CATEGORY_LABELS[detail.report.category]}
                          {detail.report.reason ? ` — “${detail.report.reason}”` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-500">Report date</dt>
                        <dd className="mt-1">
                          {new Date(detail.report.createdAt).toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-500">Reporter</dt>
                        <dd className="mt-1 break-all font-mono text-xs">
                          {detail.report.reporterHandle ??
                            detail.context.meta?.reporterHandle ??
                            '—'}
                          <span className="block text-stone-500">{detail.report.reporter}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-500">Reported person</dt>
                        <dd className="mt-1 break-all font-mono text-xs">
                          {detail.report.targetHandle ?? detail.context.meta?.targetHandle ?? '—'}
                          <span className="block text-stone-500">{detail.report.target}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-500">Topic</dt>
                        <dd className="mt-1">
                          {detail.report.topic ??
                            detail.context.meta?.topic ??
                            'General Peer Discovery'}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-500">Reported IP</dt>
                        <dd className="mt-1 break-all font-mono text-xs">
                          {detail.report.ipAddress ?? 'Unavailable'}
                        </dd>
                      </div>
                    </dl>
                    {detail.report.adminNote && (
                      <p className="rounded-lg bg-stone-500/10 p-3 text-xs">
                        <strong>Previous admin note:</strong> {detail.report.adminNote}
                      </p>
                    )}
                  </section>

                  <section aria-label="Reported conversation">
                    <h3 className="flex items-center gap-2 text-sm font-bold">
                      <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                      Reported conversation
                      <span className="font-normal text-stone-500">
                        ({detail.context.messages.length} messages)
                      </span>
                    </h3>
                    {detail.context.messages.length === 0 ? (
                      <p className="mt-2 rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-500 dark:border-stone-700">
                        The chat room already expired, so only the report metadata above is
                        available. Decide on the category, reporter history, and IP signals.
                      </p>
                    ) : (
                      <ol className="mt-3 space-y-2">
                        {detail.context.messages.map((message, index) => (
                          <li
                            key={`${message.messageId}-${index}`}
                            className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                              message.senderRole === 'system'
                                ? 'mx-auto bg-stone-500/10 text-center text-xs text-stone-500'
                                : message.senderRole === 'reporter'
                                  ? 'ml-auto bg-emerald-600/10'
                                  : 'mr-auto bg-stone-500/10'
                            }`}
                          >
                            <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                              {message.senderRole === 'system'
                                ? 'System'
                                : `${message.senderHandle} · ${message.senderRole === 'reporter' ? 'reporter' : 'reported person'}`}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap break-words">{message.text}</p>
                            <p className="mt-1 text-[11px] text-stone-500">
                              {new Date(message.createdAt).toLocaleString()}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>

                  <section aria-label="Admin history">
                    <h3 className="flex items-center gap-2 text-sm font-bold">
                      <History className="h-4 w-4" aria-hidden="true" />
                      Admin history
                    </h3>
                    {detail.actions.length === 0 ? (
                      <p className="mt-2 text-sm text-stone-500">
                        No admin decisions recorded for this report yet.
                      </p>
                    ) : (
                      <ol className="mt-2 space-y-1.5 text-sm">
                        {detail.actions.map((entry) => (
                          <li
                            key={entry.id}
                            className="rounded-lg border border-stone-200 px-3 py-2 text-xs dark:border-stone-800"
                          >
                            <span className="font-bold capitalize">{entry.action}</span>
                            <span className="text-stone-500">
                              {' '}
                              · {entry.admin} · {new Date(entry.createdAt).toLocaleString()}
                            </span>
                            {entry.detail && (
                              <span className="mt-1 block break-words">{entry.detail}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>

                  {activeReport && (
                    <section aria-label="Moderation decision" className="space-y-3">
                      <label htmlFor="admin-decision-note" className="block text-sm font-semibold">
                        Decision note (optional, stored with the report)
                      </label>
                      <textarea
                        id="admin-decision-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        maxLength={1000}
                        placeholder="Context for the next reviewer…"
                        className="w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-stone-700"
                      />
                      {!pendingConfirm ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyId?.startsWith(activeReport.id)}
                            onClick={() => setPendingConfirm({ action: 'resolve' })}
                            className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            disabled={busyId?.startsWith(activeReport.id)}
                            onClick={() => setPendingConfirm({ action: 'dismiss' })}
                            className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            disabled={busyId?.startsWith(activeReport.id)}
                            onClick={() => setPendingConfirm({ action: 'escalate' })}
                            className="rounded-lg bg-purple-700 px-3 py-2 text-xs font-bold text-white hover:bg-purple-600 disabled:opacity-50"
                          >
                            Escalate
                          </button>
                          {!activeReport.actorBanned ? (
                            <>
                              <button
                                type="button"
                                disabled={busyId?.startsWith(activeReport.id)}
                                onClick={() => setPendingConfirm({ action: 'ban' })}
                                className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                              >
                                Restrict browser
                              </button>
                              <button
                                type="button"
                                disabled={
                                  busyId?.startsWith(activeReport.id) || !activeReport.ipAddress
                                }
                                onClick={() =>
                                  setPendingConfirm({ action: 'ban', includeIp: true })
                                }
                                title={
                                  activeReport.ipAddress
                                    ? 'Restrict the browser and its reported IP'
                                    : 'No verified IP on this report'
                                }
                                className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50"
                              >
                                Restrict browser + IP
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId?.startsWith(activeReport.id)}
                              onClick={() => setPendingConfirm({ action: 'unban' })}
                              className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                            >
                              Lift browser restriction
                            </button>
                          )}
                          {activeReport.ipBanned && (
                            <button
                              type="button"
                              disabled={busyId?.startsWith(activeReport.id)}
                              onClick={() => setPendingConfirm({ action: 'unbanIp' })}
                              className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                            >
                              Lift IP restriction
                            </button>
                          )}
                        </div>
                      ) : (
                        <div
                          role="alertdialog"
                          aria-modal="false"
                          aria-label={`Confirm ${pendingConfirm.action}`}
                          aria-describedby="admin-confirm-text"
                          className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                        >
                          <p id="admin-confirm-text">
                            {pendingConfirm.action === 'ban' ? (
                              <>
                                Apply a{' '}
                                <strong>
                                  {BAN_DURATIONS.find((d) => d.value === duration)?.label}
                                </strong>{' '}
                                restriction to this browser
                                {pendingConfirm.includeIp ? ' and its reported IP' : ''}? Peers in
                                active chats are disconnected immediately.
                              </>
                            ) : pendingConfirm.action === 'escalate' ? (
                              <>
                                Escalate this report for further review? It stays open to senior
                                moderators.
                              </>
                            ) : pendingConfirm.action === 'dismiss' ? (
                              <>Dismiss this report without action? The reporter is not notified.</>
                            ) : pendingConfirm.action === 'resolve' ? (
                              <>Mark this report resolved?</>
                            ) : (
                              <>Lift this restriction? The person can match and chat again.</>
                            )}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              ref={confirmButtonRef}
                              type="button"
                              disabled={busyId?.startsWith(activeReport.id)}
                              onClick={() =>
                                void moderate(
                                  activeReport,
                                  pendingConfirm.action,
                                  pendingConfirm.includeIp,
                                )
                              }
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              Confirm {pendingConfirm.action}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingConfirm(null)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') setPendingConfirm(null);
                              }}
                              className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
