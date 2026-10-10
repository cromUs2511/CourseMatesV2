import { moderateText, type ReportCategory } from './safety';

export type TriageSenderRole = 'reporter' | 'target' | 'system';
export type TriageMessage = {
  text: string;
  senderRole: TriageSenderRole;
  createdAt: number;
};
export type TriageSignal = {
  code: string;
  detail: string;
  weight: number;
};
export type TriageLabel = 'low' | 'medium' | 'high' | 'critical';
export type TriageResult = {
  score: number;
  label: TriageLabel;
  signals: TriageSignal[];
};
export type TriageHistory = {
  reportsAgainstTarget: number;
  targetBans: number;
  reportsFiledByReporter: number;
};

const CATEGORY_PRIOR: Record<ReportCategory, { weight: number; detail: string }> = {
  threats: { weight: 10, detail: 'Threats are always treated as high priority.' },
  sexual: { weight: 10, detail: 'Sexual content reports are always treated as high priority.' },
  harassment: { weight: 6, detail: 'Harassment reports start with an elevated prior.' },
  spam: { weight: 4, detail: 'Spam reports start with a low prior.' },
  other: { weight: 2, detail: 'General reports start with a minimal prior.' },
};

const SPAM_WINDOW_MS = 90_000;
const SPAM_BURST_COUNT = 6;
const DUPLICATE_COUNT = 3;

function normalizeForComparison(text: string): string {
  return text
    .replace(/\[(photo|voice message) attached\]/g, ' ')
    .replace(/♫.*$/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic report triage. No network, no model calls: it combines the
 * existing deterministic content filter with behavioral signals (bursts,
 * repetition, category prior, target history) into a 0–100 score. It never
 * bans anyone; the runtime only auto-escalates critical scores so a human
 * still makes every enforcement decision.
 */
export function triageConversation(
  messages: TriageMessage[],
  category: ReportCategory,
  history: TriageHistory = {
    reportsAgainstTarget: 0,
    targetBans: 0,
    reportsFiledByReporter: 0,
  },
): TriageResult {
  const signals: TriageSignal[] = [];
  const prior = CATEGORY_PRIOR[category] ?? CATEGORY_PRIOR.other;
  signals.push({ code: 'category-prior', detail: prior.detail, weight: prior.weight });

  const targetMessages = (Array.isArray(messages) ? messages : []).filter(
    (message): message is TriageMessage =>
      !!message &&
      typeof message === 'object' &&
      message.senderRole === 'target' &&
      typeof message.text === 'string' &&
      message.text.trim().length > 0,
  );

  let severe = 0;
  let concerning = 0;
  for (const message of targetMessages.slice(0, 60)) {
    let verdict: { allowed: boolean; categories: string[] };
    try {
      verdict = moderateText(message.text.slice(0, 4000));
    } catch {
      continue;
    }
    if (!verdict.allowed) severe += 1;
    else if (
      verdict.categories.some((item) =>
        ['harassment', 'sexual', 'threats', 'self_harm'].includes(item),
      )
    )
      concerning += 1;
  }
  if (severe > 0)
    signals.push({
      code: 'severe-language',
      detail: `${severe} message${severe === 1 ? '' : 's'} from the reported person matched a severe filter rule.`,
      weight: Math.min(45 + (severe - 1) * 10, 65),
    });
  if (concerning > 0)
    signals.push({
      code: 'concerning-language',
      detail: `${concerning} message${concerning === 1 ? '' : 's'} matched a mild policy category.`,
      weight: Math.min(concerning * 6, 18),
    });

  const times = targetMessages
    .map((message) => message.createdAt)
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  let burst = 0;
  for (let start = 0; start < times.length; start += 1) {
    const startTime = times[start]!;
    let count = 0;
    for (let end = start; end < times.length && times[end]! - startTime <= SPAM_WINDOW_MS; end += 1)
      count += 1;
    burst = Math.max(burst, count);
  }
  if (burst >= SPAM_BURST_COUNT)
    signals.push({
      code: 'spam-burst',
      detail: `${burst} messages in 90 seconds — possible spam or flooding.`,
      weight: 20,
    });

  const duplicates = new Map<string, number>();
  for (const message of targetMessages) {
    const normalized = normalizeForComparison(message.text);
    if (normalized.length < 4) continue;
    duplicates.set(normalized, (duplicates.get(normalized) ?? 0) + 1);
  }
  const repeated = [...duplicates.values()].reduce((max, count) => Math.max(max, count), 0);
  if (repeated >= DUPLICATE_COUNT)
    signals.push({
      code: 'repeated-messages',
      detail: `The same message was sent ${repeated} times — possible spam or copy-paste abuse.`,
      weight: 18,
    });

  const against = Math.max(0, Math.floor(history.reportsAgainstTarget || 0));
  const bans = Math.max(0, Math.floor(history.targetBans || 0));
  const filed = Math.max(0, Math.floor(history.reportsFiledByReporter || 0));
  if (bans > 0)
    signals.push({
      code: 'target-recidivism',
      detail: 'This person was restricted before.',
      weight: 15,
    });
  else if (against >= 3)
    signals.push({
      code: 'target-repeat-reports',
      detail: `${against} earlier reports name the same person.`,
      weight: 8,
    });
  if (filed >= 15)
    signals.push({
      code: 'frequent-reporter',
      detail: 'This reporter files an unusually high volume of reports — review for misuse.',
      weight: 0,
    });

  const score = Math.min(
    100,
    signals.reduce((total, signal) => total + Math.max(0, signal.weight), 0),
  );
  const label: TriageLabel =
    score >= 80 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, label, signals };
}

/** Score at or above which a report is auto-escalated for human review.
 * `AUTO_MOD_ESCALATE_SCORE=0` (or `off`) disables auto-escalation. Anything
 * else parses as 1–100 and defaults to 80. Reads only configuration, never
 * secrets, so it is safe to call per request.
 */
export function autoEscalateThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AUTO_MOD_ESCALATE_SCORE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return 80;
  if (raw === '0' || raw === 'off' || raw === 'disabled') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 80;
  return Math.min(100, Math.max(1, Math.round(parsed)));
}
