import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type ReportSenderRole = 'reporter' | 'target' | 'system';
export type ReportChatMessage = {
  messageId: string;
  senderRole: ReportSenderRole;
  senderHandle: string;
  text: string;
  createdAt: number;
};
export type ReportContextMeta = {
  roomId: string | null;
  topic: string | null;
  reporterHandle: string | null;
  targetHandle: string | null;
  createdAt: number;
};
export type AdminActionType =
  'resolve' | 'dismiss' | 'escalate' | 'ban' | 'unban' | 'unbanIp' | 'banImage' | 'unbanImage';
export type AdminActionRecord = {
  id: number;
  createdAt: number;
  admin: string;
  action: AdminActionType;
  reportId: string | null;
  detail: string | null;
};
export type AutoFlag = {
  reportId: string;
  score: number;
  label: 'low' | 'medium' | 'high' | 'critical';
  signals: Array<{ code: string; detail: string; weight: number }>;
  createdAt: number;
};
export type BannedImage = {
  hash: string;
  createdAt: number;
  reportId: string | null;
};

const IMAGE_HASH_PATTERN = /^[a-f0-9]{64}$/;

const ADMIN_ACTIONS: readonly AdminActionType[] = [
  'resolve',
  'dismiss',
  'escalate',
  'ban',
  'unban',
  'unbanIp',
  'banImage',
  'unbanImage',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve the SQLite file for moderation review data.
 * Explicit MODERATION_DB_PATH wins, otherwise DATA_DIR/moderation.db.
 * Returns undefined when no durable location is configured (memory-only).
 */
export function resolveModerationDbPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.MODERATION_DB_PATH?.trim();
  if (explicit) return explicit;
  const dataDir = env.DATA_DIR?.trim();
  if (dataDir) return `${dataDir.replace(/[/\\]+$/, '')}/moderation.db`;
  return undefined;
}

/** Persistent SQLite store for report chat context and admin audit history.
 * Bans/blocks/report metadata remain in SafetyStore; this file holds only the
 * reported conversation excerpt (text, no media bytes) plus the admin trail.
 * Everything is pruned after 30 days except permanent-ban audit entries.
 */
export class ModerationDb {
  private readonly db: DatabaseSync;
  private readonly filePath: string | undefined;

  constructor(path?: string) {
    this.filePath = path;
    if (path) mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path ?? ':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
    if (path) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL');
      } catch {
        /* Filesystems that reject WAL keep the default rollback journal. */
      }
    }
    this.migrate();
  }

  get path(): string | undefined {
    return this.filePath;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* Best effort on shutdown. */
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS report_contexts (
        report_id TEXT PRIMARY KEY,
        room_id TEXT,
        topic TEXT,
        reporter_handle TEXT,
        target_handle TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS report_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id TEXT NOT NULL REFERENCES report_contexts(report_id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        sender_handle TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_report_messages_report
        ON report_messages(report_id, seq);
      CREATE TABLE IF NOT EXISTS admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        admin TEXT NOT NULL,
        action TEXT NOT NULL,
        report_id TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_admin_actions_report
        ON admin_actions(report_id, id);
      CREATE TABLE IF NOT EXISTS auto_flags (
        report_id TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        label TEXT NOT NULL,
        signals TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS banned_image_hashes (
        image_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        report_id TEXT
      );
      CREATE TABLE IF NOT EXISTS report_image_hashes (
        report_id TEXT NOT NULL,
        image_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (report_id, image_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_report_image_hashes_report
        ON report_image_hashes(report_id);
    `);
    const row = this.db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get() as
      { version?: number } | undefined;
    if (!row || !isRecord(row) || row.version !== 1) {
      this.db
        .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)')
        .run(Date.now());
    }
  }

  saveReportContext(
    reportId: string,
    meta: ReportContextMeta,
    messages: ReportChatMessage[],
  ): void {
    if (typeof reportId !== 'string' || reportId.length > 100 || !reportId) return;
    const roomId = typeof meta.roomId === 'string' ? meta.roomId.slice(0, 100) : null;
    const topic = typeof meta.topic === 'string' ? meta.topic.slice(0, 200) : null;
    const reporterHandle =
      typeof meta.reporterHandle === 'string' ? meta.reporterHandle.slice(0, 100) : null;
    const targetHandle =
      typeof meta.targetHandle === 'string' ? meta.targetHandle.slice(0, 100) : null;
    const createdAt = Number.isFinite(meta.createdAt) ? meta.createdAt : Date.now();
    const capped = Array.isArray(messages) ? messages.slice(-50) : [];
    const save = this.db.prepare(
      `INSERT INTO report_contexts(report_id, room_id, topic, reporter_handle, target_handle, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id) DO UPDATE SET
         room_id = excluded.room_id,
         topic = excluded.topic,
         reporter_handle = excluded.reporter_handle,
         target_handle = excluded.target_handle`,
    );
    const clear = this.db.prepare('DELETE FROM report_messages WHERE report_id = ?');
    const insert = this.db.prepare(
      `INSERT INTO report_messages(report_id, seq, message_id, sender_role, sender_handle, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    save.run(reportId, roomId, topic, reporterHandle, targetHandle, createdAt);
    clear.run(reportId);
    capped.forEach((message, index) => {
      if (!isRecord(message)) return;
      const role: ReportSenderRole =
        message.senderRole === 'target'
          ? 'target'
          : message.senderRole === 'system'
            ? 'system'
            : 'reporter';
      insert.run(
        reportId,
        index,
        String(message.messageId ?? '').slice(0, 200),
        role,
        String(message.senderHandle ?? '').slice(0, 100),
        String(message.text ?? '').slice(0, 4000),
        Number.isFinite(message.createdAt) ? message.createdAt : createdAt,
      );
    });
  }

  getReportContext(
    reportId: string,
  ): { meta: ReportContextMeta; messages: ReportChatMessage[] } | undefined {
    if (typeof reportId !== 'string' || !reportId) return undefined;
    const meta = this.db
      .prepare(
        'SELECT room_id AS roomId, topic, reporter_handle AS reporterHandle, target_handle AS targetHandle, created_at AS createdAt FROM report_contexts WHERE report_id = ?',
      )
      .get(reportId) as Record<string, unknown> | undefined;
    if (!meta || !isRecord(meta)) return undefined;
    const rows = this.db
      .prepare(
        `SELECT message_id AS messageId, sender_role AS senderRole, sender_handle AS senderHandle, text, created_at AS createdAt
         FROM report_messages WHERE report_id = ? ORDER BY seq ASC LIMIT 50`,
      )
      .all(reportId) as Record<string, unknown>[];
    return {
      meta: {
        roomId: typeof meta.roomId === 'string' ? meta.roomId : null,
        topic: typeof meta.topic === 'string' ? meta.topic : null,
        reporterHandle: typeof meta.reporterHandle === 'string' ? meta.reporterHandle : null,
        targetHandle: typeof meta.targetHandle === 'string' ? meta.targetHandle : null,
        createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
      },
      messages: rows.map((row) => ({
        messageId: String(row.messageId ?? ''),
        senderRole:
          row.senderRole === 'target'
            ? ('target' as const)
            : row.senderRole === 'system'
              ? ('system' as const)
              : ('reporter' as const),
        senderHandle: String(row.senderHandle ?? ''),
        text: String(row.text ?? ''),
        createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      })),
    };
  }

  contextMetaFor(reportIds: string[]): Record<string, { messageCount: number }> {
    const counts: Record<string, { messageCount: number }> = {};
    const ids = [...new Set(reportIds.filter((id) => typeof id === 'string' && id))].slice(0, 500);
    if (!ids.length) return counts;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT report_id AS reportId, COUNT(*) AS messageCount FROM report_messages
         WHERE report_id IN (${placeholders}) GROUP BY report_id`,
      )
      .all(...ids) as Record<string, unknown>[];
    for (const row of rows) {
      if (isRecord(row) && typeof row.reportId === 'string')
        counts[row.reportId] = {
          messageCount: typeof row.messageCount === 'number' ? row.messageCount : 0,
        };
    }
    return counts;
  }

  logAdminAction(entry: {
    admin: string;
    action: AdminActionType;
    reportId?: string | null;
    detail?: string | null;
    createdAt?: number;
  }): void {
    if (!(ADMIN_ACTIONS as readonly string[]).includes(entry.action)) return;
    const admin =
      typeof entry.admin === 'string' && entry.admin.trim()
        ? entry.admin.trim().slice(0, 100)
        : 'admin';
    const reportId =
      typeof entry.reportId === 'string' && entry.reportId ? entry.reportId.slice(0, 100) : null;
    const detail =
      typeof entry.detail === 'string' && entry.detail ? entry.detail.slice(0, 4000) : null;
    this.db
      .prepare(
        'INSERT INTO admin_actions(created_at, admin, action, report_id, detail) VALUES (?, ?, ?, ?, ?)',
      )
      .run(entry.createdAt ?? Date.now(), admin, entry.action, reportId, detail);
  }

  listAdminActions(reportId?: string, limit = 100): AdminActionRecord[] {
    const capped = Number.isSafeInteger(limit) ? Math.max(1, Math.min(500, limit)) : 100;
    const rows =
      typeof reportId === 'string' && reportId
        ? (this.db
            .prepare(
              'SELECT id, created_at AS createdAt, admin, action, report_id AS reportId, detail FROM admin_actions WHERE report_id = ? ORDER BY id DESC LIMIT ?',
            )
            .all(reportId, capped) as Record<string, unknown>[])
        : (this.db
            .prepare(
              'SELECT id, created_at AS createdAt, admin, action, report_id AS reportId, detail FROM admin_actions ORDER BY id DESC LIMIT ?',
            )
            .all(capped) as Record<string, unknown>[]);
    return rows.filter(isRecord).map((row) => ({
      id: typeof row.id === 'number' ? row.id : 0,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      admin: typeof row.admin === 'string' ? row.admin : 'admin',
      action: (ADMIN_ACTIONS as readonly string[]).includes(String(row.action))
        ? (row.action as AdminActionType)
        : ('resolve' as const),
      reportId: typeof row.reportId === 'string' ? row.reportId : null,
      detail: typeof row.detail === 'string' ? row.detail : null,
    }));
  }

  saveAutoFlag(flag: AutoFlag): void {
    if (typeof flag.reportId !== 'string' || !flag.reportId) return;
    const score = Number.isFinite(flag.score)
      ? Math.max(0, Math.min(100, Math.round(flag.score)))
      : 0;
    const label =
      flag.label === 'critical' || flag.label === 'high' || flag.label === 'medium'
        ? flag.label
        : 'low';
    const signals = Array.isArray(flag.signals)
      ? flag.signals
          .filter(
            (signal): signal is { code: string; detail: string; weight: number } =>
              !!signal &&
              typeof signal === 'object' &&
              typeof signal.code === 'string' &&
              typeof signal.detail === 'string' &&
              Number.isFinite(signal.weight),
          )
          .slice(0, 20)
          .map((signal) => ({
            code: signal.code.slice(0, 60),
            detail: signal.detail.slice(0, 500),
            weight: signal.weight,
          }))
      : [];
    this.db
      .prepare(
        `INSERT INTO auto_flags(report_id, score, label, signals, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(report_id) DO UPDATE SET
           score = excluded.score, label = excluded.label,
           signals = excluded.signals, created_at = excluded.created_at`,
      )
      .run(flag.reportId, score, label, JSON.stringify(signals), flag.createdAt ?? Date.now());
  }

  getAutoFlag(reportId: string): AutoFlag | undefined {
    if (typeof reportId !== 'string' || !reportId) return undefined;
    const row = this.db
      .prepare(
        'SELECT score, label, signals, created_at AS createdAt FROM auto_flags WHERE report_id = ?',
      )
      .get(reportId) as Record<string, unknown> | undefined;
    if (!row || !isRecord(row) || typeof row.score !== 'number') return undefined;
    let signals: AutoFlag['signals'] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.signals ?? '[]'));
      if (Array.isArray(parsed))
        signals = parsed
          .filter(isRecord)
          .filter(
            (signal) =>
              typeof signal.code === 'string' &&
              typeof signal.detail === 'string' &&
              typeof signal.weight === 'number',
          )
          .map((signal) => ({
            code: signal.code as string,
            detail: signal.detail as string,
            weight: signal.weight as number,
          }));
    } catch {
      signals = [];
    }
    return {
      reportId,
      score: row.score,
      label:
        row.label === 'critical' || row.label === 'high' || row.label === 'medium'
          ? row.label
          : 'low',
      signals,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
    };
  }

  listAutoFlags(reportIds: string[]): Record<string, Pick<AutoFlag, 'score' | 'label'>> {
    const flags: Record<string, Pick<AutoFlag, 'score' | 'label'>> = {};
    const ids = [...new Set(reportIds.filter((id) => typeof id === 'string' && id))].slice(0, 500);
    if (!ids.length) return flags;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT report_id AS reportId, score, label FROM auto_flags WHERE report_id IN (${placeholders})`,
      )
      .all(...ids) as Record<string, unknown>[];
    for (const row of rows) {
      if (isRecord(row) && typeof row.reportId === 'string' && typeof row.score === 'number')
        flags[row.reportId] = {
          score: row.score,
          label:
            row.label === 'critical' || row.label === 'high' || row.label === 'medium'
              ? row.label
              : 'low',
        };
    }
    return flags;
  }

  imageHashBanned(hash: string): boolean {
    if (typeof hash !== 'string' || !IMAGE_HASH_PATTERN.test(hash)) return false;
    const row = this.db
      .prepare('SELECT image_hash FROM banned_image_hashes WHERE image_hash = ?')
      .get(hash) as Record<string, unknown> | undefined;
    return !!row && isRecord(row);
  }

  banImageHash(hash: string, reportId?: string | null): void {
    if (typeof hash !== 'string' || !IMAGE_HASH_PATTERN.test(hash)) return;
    this.db
      .prepare(
        `INSERT INTO banned_image_hashes(image_hash, created_at, report_id)
         VALUES (?, ?, ?) ON CONFLICT(image_hash) DO NOTHING`,
      )
      .run(
        hash,
        Date.now(),
        typeof reportId === 'string' && reportId ? reportId.slice(0, 100) : null,
      );
  }

  unbanImageHash(hash: string): void {
    if (typeof hash !== 'string' || !IMAGE_HASH_PATTERN.test(hash)) return;
    this.db.prepare('DELETE FROM banned_image_hashes WHERE image_hash = ?').run(hash);
  }

  listBannedImageHashes(limit = 200): BannedImage[] {
    const capped = Number.isSafeInteger(limit) ? Math.max(1, Math.min(1000, limit)) : 200;
    const rows = this.db
      .prepare(
        'SELECT image_hash AS hash, created_at AS createdAt, report_id AS reportId FROM banned_image_hashes ORDER BY created_at DESC LIMIT ?',
      )
      .all(capped) as Record<string, unknown>[];
    return rows.filter(isRecord).map((row) => ({
      hash: typeof row.hash === 'string' ? row.hash : '',
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      reportId: typeof row.reportId === 'string' ? row.reportId : null,
    }));
  }

  saveReportImageHashes(reportId: string, hashes: string[]): void {
    if (typeof reportId !== 'string' || !reportId || !Array.isArray(hashes)) return;
    const insert = this.db.prepare(
      `INSERT INTO report_image_hashes(report_id, image_hash, created_at)
       VALUES (?, ?, ?) ON CONFLICT(report_id, image_hash) DO NOTHING`,
    );
    const now = Date.now();
    for (const hash of [...new Set(hashes)].slice(0, 20)) {
      if (typeof hash === 'string' && IMAGE_HASH_PATTERN.test(hash))
        insert.run(reportId, hash, now);
    }
  }

  getReportImageHashes(reportId: string): string[] {
    if (typeof reportId !== 'string' || !reportId) return [];
    const rows = this.db
      .prepare(
        'SELECT image_hash AS hash FROM report_image_hashes WHERE report_id = ? ORDER BY rowid ASC',
      )
      .all(reportId) as Record<string, unknown>[];
    return rows
      .filter(isRecord)
      .map((row) => row.hash)
      .filter((hash): hash is string => typeof hash === 'string');
  }

  reportImageHashCounts(reportIds: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    const ids = [...new Set(reportIds.filter((id) => typeof id === 'string' && id))].slice(0, 500);
    if (!ids.length) return counts;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT report_id AS reportId, COUNT(*) AS hashCount FROM report_image_hashes
         WHERE report_id IN (${placeholders}) GROUP BY report_id`,
      )
      .all(...ids) as Record<string, unknown>[];
    for (const row of rows) {
      if (isRecord(row) && typeof row.reportId === 'string' && typeof row.hashCount === 'number')
        counts[row.reportId] = row.hashCount;
    }
    return counts;
  }

  prune(before: number): void {
    if (!Number.isFinite(before)) return;
    this.db.prepare('DELETE FROM report_messages WHERE created_at < ?').run(before);
    this.db.prepare('DELETE FROM report_contexts WHERE created_at < ?').run(before);
    this.db.prepare('DELETE FROM auto_flags WHERE created_at < ?').run(before);
    this.db.prepare('DELETE FROM report_image_hashes WHERE created_at < ?').run(before);
    this.db
      .prepare(
        "DELETE FROM admin_actions WHERE created_at < ? AND action NOT IN ('ban', 'unban', 'unbanIp', 'banImage', 'unbanImage')",
      )
      .run(before);
  }
}
