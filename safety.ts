import { createHmac, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import patterns from './moderation-patterns.json';

export const REPORT_CATEGORIES = ['harassment', 'spam', 'sexual', 'threats', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type SafetyReport = {
  id: string;
  reporter: string;
  target: string;
  category: ReportCategory;
  createdAt: number;
  status: 'open' | 'resolved';
};

type Ban = { actor: string; createdAt: number; until: number };
type Block = { actor: string; target: string; createdAt: number };
type State = {
  version: 1;
  secretCheck: string;
  bans: Ban[];
  blocks: Block[];
  reports: SafetyReport[];
};
const DAY = 86_400_000;
export const SAFETY_RETENTION_MS = 30 * DAY;
const validActor = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finiteTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export class SafetyStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyStoreError';
  }
}

/** Single-process moderation metadata. Production must use a durable private path.
 * No message content, email addresses, IP addresses, or session tokens are stored.
 * Storage failures stop further operations; restart after repairing the volume.
 */
export class SafetyStore {
  private state: State;
  private readonly path?: string;
  private readonly secret: string;
  private readonly now: () => number;
  private readonly maxRecords: number;
  private unavailable = false;

  constructor(options: { path?: string; secret: string; now?: () => number; maxRecords?: number }) {
    if (typeof options.secret !== 'string' || !options.secret)
      throw new SafetyStoreError('Moderation secret is required.');
    this.secret = options.secret;
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.maxRecords = options.maxRecords ?? 10_000;
    if (
      !Number.isSafeInteger(this.maxRecords) ||
      this.maxRecords < 1 ||
      this.maxRecords > 1_000_000
    )
      throw new SafetyStoreError('Invalid moderation capacity.');
    const secretCheck = createHmac('sha256', this.secret)
      .update('coursemates-moderation-store-v1')
      .digest('hex');
    this.state = { version: 1, secretCheck, bans: [], blocks: [], reports: [] };
    if (this.path) {
      try {
        const stat = lstatSync(this.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.maxRecords * 600 + 4096)
          throw new Error('Invalid moderation file.');
        const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
        this.validateState(parsed, secretCheck);
        this.state = parsed;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
          throw new SafetyStoreError('Moderation store could not be read safely.');
        this.persist(this.state);
      }
    }
    this.prune();
  }

  actor(browserId: string): string {
    this.assertAvailable();
    if (typeof browserId !== 'string' || !browserId || browserId.length > 256)
      throw new SafetyStoreError('Invalid browser identifier.');
    return createHmac('sha256', this.secret).update(`actor:${browserId}`).digest('hex');
  }

  isBanned(actor: string): boolean {
    this.assertActor(actor);
    this.prune();
    return this.state.bans.some((ban) => ban.actor === actor);
  }

  block(actor: string, target: string): void {
    this.assertPair(actor, target);
    this.prune();
    this.mutate((state) => {
      const existing = state.blocks.find(
        (block) => block.actor === actor && block.target === target,
      );
      if (existing) existing.createdAt = this.now();
      else state.blocks.push({ actor, target, createdAt: this.now() });
    });
  }

  isBlocked(a: string, b: string): boolean {
    this.assertActor(a);
    this.assertActor(b);
    this.prune();
    return this.state.blocks.some(
      (block) =>
        (block.actor === a && block.target === b) || (block.actor === b && block.target === a),
    );
  }

  report(reporter: string, target: string, category: ReportCategory): SafetyReport {
    this.assertPair(reporter, target);
    if (!(REPORT_CATEGORIES as readonly string[]).includes(category))
      throw new SafetyStoreError('Invalid report category.');
    this.prune();
    const createdAt = this.now();
    if (
      this.state.reports.filter(
        (item) => item.reporter === reporter && item.createdAt > createdAt - DAY,
      ).length >= 20
    )
      throw new SafetyStoreError('Daily report limit reached.');
    const report: SafetyReport = {
      id: randomUUID(),
      reporter,
      target,
      category,
      createdAt,
      status: 'open',
    };
    this.mutate((state) => {
      state.reports.push(report);
    });
    return { ...report };
  }

  listReports(): SafetyReport[] {
    this.prune();
    return this.state.reports.map((report) => ({ ...report }));
  }

  ban(actor: string, durationMs = SAFETY_RETENTION_MS): void {
    this.assertActor(actor);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > SAFETY_RETENTION_MS)
      throw new SafetyStoreError('Ban duration must be between 1 ms and 30 days.');
    this.prune();
    const createdAt = this.now();
    this.mutate((state) => {
      state.bans = state.bans.filter((ban) => ban.actor !== actor);
      state.bans.push({ actor, createdAt, until: createdAt + durationMs });
    });
  }

  unban(actor: string): void {
    this.assertActor(actor);
    this.prune();
    this.mutate((state) => {
      state.bans = state.bans.filter((ban) => ban.actor !== actor);
    });
  }

  resolveReport(id: string): void {
    this.prune();
    this.mutate((state) => {
      const report = state.reports.find((item) => item.id === id);
      if (!report) throw new SafetyStoreError('Report not found.');
      report.status = 'resolved';
    });
  }

  counts(): { bans: number; blocks: number; reports: number; openReports: number } {
    this.prune();
    return {
      bans: this.state.bans.length,
      blocks: this.state.blocks.length,
      reports: this.state.reports.length,
      openReports: this.state.reports.filter((report) => report.status === 'open').length,
    };
  }

  private assertAvailable(): void {
    if (this.unavailable) throw new SafetyStoreError('Moderation store is unavailable.');
  }

  private assertActor(actor: string): void {
    this.assertAvailable();
    if (!validActor(actor)) throw new SafetyStoreError('Invalid moderation identity.');
  }

  private assertPair(actor: string, target: string): void {
    this.assertActor(actor);
    this.assertActor(target);
    if (actor === target) throw new SafetyStoreError('You cannot report or block yourself.');
  }

  private prune(): void {
    this.assertAvailable();
    const now = this.now();
    const cutoff = now - SAFETY_RETENTION_MS;
    const next: State = {
      ...this.state,
      bans: this.state.bans.filter((ban) => ban.until > now),
      blocks: this.state.blocks.filter((block) => block.createdAt > cutoff),
      reports: this.state.reports.filter((report) => report.createdAt > cutoff),
    };
    if (
      next.bans.length !== this.state.bans.length ||
      next.blocks.length !== this.state.blocks.length ||
      next.reports.length !== this.state.reports.length
    ) {
      this.persist(next);
      this.state = next;
    }
  }

  private mutate(change: (state: State) => void): void {
    this.assertAvailable();
    const next = structuredClone(this.state);
    change(next);
    if (next.bans.length + next.blocks.length + next.reports.length > this.maxRecords)
      throw new SafetyStoreError('Moderation store capacity reached.');
    this.persist(next);
    this.state = next;
  }

  private persist(state: State): void {
    if (!this.path) return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify(state));
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, this.path);
    } catch {
      this.unavailable = true;
      throw new SafetyStoreError('Moderation store could not be persisted safely.');
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          /* Preserve the original storage failure. */
        }
      }
      try {
        unlinkSync(temporary);
      } catch {
        /* Renamed successfully, or best-effort cleanup after a failed write. */
      }
    }
  }

  private validateState(value: unknown, secretCheck: string): asserts value is State {
    if (
      !record(value) ||
      !exactKeys(value, ['version', 'secretCheck', 'bans', 'blocks', 'reports']) ||
      value.version !== 1 ||
      value.secretCheck !== secretCheck ||
      !Array.isArray(value.bans) ||
      !Array.isArray(value.blocks) ||
      !Array.isArray(value.reports)
    )
      throw new Error('Invalid state.');
    if (value.bans.length + value.blocks.length + value.reports.length > this.maxRecords)
      throw new Error('Capacity exceeded.');
    const validCreated = (time: unknown) => finiteTime(time) && time <= this.now();
    for (const ban of value.bans) {
      if (
        !record(ban) ||
        !exactKeys(ban, ['actor', 'createdAt', 'until']) ||
        !validActor(ban.actor) ||
        !finiteTime(ban.createdAt) ||
        !validCreated(ban.createdAt) ||
        !finiteTime(ban.until) ||
        ban.until <= ban.createdAt ||
        ban.until - ban.createdAt > SAFETY_RETENTION_MS
      )
        throw new Error('Invalid ban.');
    }
    for (const block of value.blocks) {
      if (
        !record(block) ||
        !exactKeys(block, ['actor', 'target', 'createdAt']) ||
        !validActor(block.actor) ||
        !validActor(block.target) ||
        block.actor === block.target ||
        !validCreated(block.createdAt)
      )
        throw new Error('Invalid block.');
    }
    for (const report of value.reports) {
      if (
        !record(report) ||
        !exactKeys(report, ['id', 'reporter', 'target', 'category', 'createdAt', 'status']) ||
        typeof report.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(report.id) ||
        !validActor(report.reporter) ||
        !validActor(report.target) ||
        report.reporter === report.target ||
        typeof report.category !== 'string' ||
        !(REPORT_CATEGORIES as readonly string[]).includes(report.category) ||
        !validCreated(report.createdAt) ||
        !['open', 'resolved'].includes(String(report.status))
      )
        throw new Error('Invalid report.');
    }
  }
}

const substitutions: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '|': 'i',
};
function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(/[013457@$|]/g, (character) => substitutions[character]!)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const filters = patterns.map((pattern) => {
  const phrase = foldText(pattern.phrase);
  // Explicit boundaries also apply to the spaced-letter evasion check. A
  // squashed substring search would mistakenly match innocent longer words.
  const aggressive = phrase
    .replace(/ /g, '')
    .replace(/(.)\1+/g, '$1')
    .split('')
    .map((character) => `${character}+(?: *${character})*`)
    .join(' *');
  return {
    ...pattern,
    normal: new RegExp(`(?:^| )${phrase}(?= |$)`),
    evasion: pattern.aggressive ? new RegExp(`(?:^| )${aggressive}(?= |$)`) : null,
  };
});

/** Deterministic baseline filter using the same policy list as native_bridge.py.
 * This does not inspect images/audio and is not a substitute for user reports.
 */
export function moderateText(text: string): { allowed: boolean; categories: string[] } {
  if (typeof text !== 'string' || text.length > 4000)
    throw new SafetyStoreError('Invalid moderation text.');
  const folded = foldText(text);
  const hits = filters.filter(
    (filter) => filter.normal.test(folded) || filter.evasion?.test(folded),
  );
  return {
    allowed: !hits.some((hit) => hit.severity >= 3),
    categories: [...new Set(hits.map((hit) => hit.category))],
  };
}
