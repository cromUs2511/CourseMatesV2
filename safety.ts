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
import { isIP } from 'node:net';
import patterns from './moderation-patterns.json';

export const REPORT_CATEGORIES = ['harassment', 'spam', 'sexual', 'threats', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type SafetyReport = {
  id: string;
  reporter: string;
  target: string;
  category: ReportCategory;
  ipAddress: string | null;
  createdAt: number;
  status: 'open' | 'resolved';
};

export type SafetyBan = {
  actor?: string;
  ipAddress?: string;
  createdAt: number;
  until: number | null;
};
type Block = { actor: string; target: string; createdAt: number };
type State = {
  version: 1;
  secretCheck: string;
  bans: SafetyBan[];
  blocks: Block[];
  reports: SafetyReport[];
};
const DAY = 86_400_000;
export const SAFETY_RETENTION_MS = 30 * DAY;
const validActor = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function normalizeIpAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 45) return null;
  const address = value.trim().toLowerCase();
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return mappedIpv4;
  return isIP(address) ? address : null;
}
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
 * No message content, email addresses, or session tokens are stored. Reported IPs
 * are retained with their report for up to 30 days; permanent IP bans do not expire.
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

  isBanned(actor: string, ipAddress?: string | null): boolean {
    this.assertActor(actor);
    this.prune();
    const ip = normalizeIpAddress(ipAddress);
    return this.state.bans.some(
      (ban) =>
        (ban.actor === actor || (!!ip && ban.ipAddress === ip)) &&
        (ban.until === null || ban.until > this.now()),
    );
  }

  isActorBanned(actor: string): boolean {
    this.assertActor(actor);
    this.prune();
    return this.state.bans.some(
      (ban) => ban.actor === actor && (ban.until === null || ban.until > this.now()),
    );
  }

  isIpBanned(ipAddress: string | null | undefined): boolean {
    const ip = normalizeIpAddress(ipAddress);
    if (!ip) return false;
    this.assertAvailable();
    this.prune();
    return this.state.bans.some(
      (ban) => ban.ipAddress === ip && (ban.until === null || ban.until > this.now()),
    );
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

  report(
    reporter: string,
    target: string,
    category: ReportCategory,
    ipAddress?: string | null,
  ): SafetyReport {
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
    const normalizedIp = ipAddress == null ? null : normalizeIpAddress(ipAddress);
    if (ipAddress != null && !normalizedIp)
      throw new SafetyStoreError('Invalid report IP address.');
    const report: SafetyReport = {
      id: randomUUID(),
      reporter,
      target,
      category,
      ipAddress: normalizedIp,
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
    return this.state.reports.map((report) => ({ ...report, ipAddress: report.ipAddress ?? null }));
  }

  listBans(): SafetyBan[] {
    this.prune();
    return this.state.bans.map((ban) => ({ ...ban }));
  }

  ban(
    actor: string,
    durationMs: number | null = SAFETY_RETENTION_MS,
    ipAddress?: string | null,
  ): void {
    this.assertActor(actor);
    if (
      durationMs !== null &&
      (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > SAFETY_RETENTION_MS)
    )
      throw new SafetyStoreError('Ban duration must be between 1 ms and 30 days.');
    const normalizedIp = ipAddress == null ? null : normalizeIpAddress(ipAddress);
    if (ipAddress != null && !normalizedIp) throw new SafetyStoreError('Invalid IP address.');
    this.prune();
    const createdAt = this.now();
    const until = durationMs === null ? null : createdAt + durationMs;
    this.mutate((state) => {
      state.bans = state.bans.filter(
        (ban) => ban.actor !== actor && (!normalizedIp || ban.ipAddress !== normalizedIp),
      );
      state.bans.push({ actor, createdAt, until });
      if (normalizedIp) state.bans.push({ ipAddress: normalizedIp, createdAt, until });
    });
  }

  unban(actor: string, ipAddress?: string | null): void {
    this.assertActor(actor);
    const normalizedIp = ipAddress == null ? null : normalizeIpAddress(ipAddress);
    if (ipAddress != null && !normalizedIp) throw new SafetyStoreError('Invalid IP address.');
    this.prune();
    this.mutate((state) => {
      state.bans = state.bans.filter(
        (ban) => ban.actor !== actor && (!normalizedIp || ban.ipAddress !== normalizedIp),
      );
    });
  }

  unbanIp(ipAddress: string): void {
    const normalizedIp = normalizeIpAddress(ipAddress);
    if (!normalizedIp) throw new SafetyStoreError('Invalid IP address.');
    this.assertAvailable();
    this.prune();
    this.mutate((state) => {
      state.bans = state.bans.filter((ban) => ban.ipAddress !== normalizedIp);
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
    if (this.state.bans.length + this.state.blocks.length + this.state.reports.length === 0) return;
    const cutoff = now - SAFETY_RETENTION_MS;
    let changed = false;
    const next: State = {
      ...this.state,
      bans: (() => {
        const filtered = this.state.bans.filter((ban) => ban.until === null || ban.until > now);
        if (filtered.length !== this.state.bans.length) changed = true;
        return filtered;
      })(),
      blocks: (() => {
        const filtered = this.state.blocks.filter((block) => block.createdAt > cutoff);
        if (filtered.length !== this.state.blocks.length) changed = true;
        return filtered;
      })(),
      reports: (() => {
        const filtered = this.state.reports.filter((report) => report.createdAt > cutoff);
        if (filtered.length !== this.state.reports.length) changed = true;
        return filtered;
      })(),
    };
    if (changed) {
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
      const hasActor = record(ban) && validActor(ban.actor);
      const hasIp = record(ban) && normalizeIpAddress(ban.ipAddress) !== null;
      if (
        !record(ban) ||
        Object.keys(ban).some(
          (key) => !['actor', 'ipAddress', 'createdAt', 'until'].includes(key),
        ) ||
        hasActor === hasIp ||
        (ban.actor !== undefined && !validActor(ban.actor)) ||
        (ban.ipAddress !== undefined && !normalizeIpAddress(ban.ipAddress)) ||
        !finiteTime(ban.createdAt) ||
        !validCreated(ban.createdAt) ||
        (ban.until !== null &&
          (!finiteTime(ban.until) ||
            ban.until <= ban.createdAt ||
            ban.until - ban.createdAt > SAFETY_RETENTION_MS))
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
        Object.keys(report).some(
          (key) =>
            !['id', 'reporter', 'target', 'category', 'ipAddress', 'createdAt', 'status'].includes(
              key,
            ),
        ) ||
        typeof report.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(report.id) ||
        !validActor(report.reporter) ||
        !validActor(report.target) ||
        report.reporter === report.target ||
        typeof report.category !== 'string' ||
        !(REPORT_CATEGORIES as readonly string[]).includes(report.category) ||
        (report.ipAddress !== undefined &&
          report.ipAddress !== null &&
          !normalizeIpAddress(report.ipAddress)) ||
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
