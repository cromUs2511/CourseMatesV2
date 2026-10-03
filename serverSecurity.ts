import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

/** Fixed windows with a bounded key set. Saturation fails closed, never evicts active keys. */
export class WindowLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(
    private maxKeys = 10000,
    private now: () => number = Date.now,
  ) {}
  take(key: string, limit: number, windowMs: number): boolean {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= this.maxKeys) {
        for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id);
        if (!this.entries.has(key) && this.entries.size >= this.maxKeys) return false;
      }
      entry = { count: 0, until: now + windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  return (
    !!b &&
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(a).digest(),
      crypto.createHash('sha256').update(b).digest(),
    )
  );
}

export function validateProductionConfig(
  env: NodeJS.ProcessEnv,
  production = env.NODE_ENV === 'production',
): void {
  if (!production) return;
  let origin: URL;
  try {
    origin = new URL(env.APP_URL || '');
  } catch {
    throw new Error('Production requires APP_URL with an HTTPS origin.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('APP_URL must be an HTTPS origin without a path or credentials.');
  if (
    env.SINGLE_INSTANCE !== 'true' ||
    (env.WEB_CONCURRENCY && env.WEB_CONCURRENCY !== '1') ||
    (env.NODE_APP_INSTANCE && env.NODE_APP_INSTANCE !== '0')
  )
    throw new Error(
      'This ephemeral runtime requires SINGLE_INSTANCE=true and exactly one process/replica.',
    );
  if (!env.DATA_DIR)
    throw new Error('Production requires DATA_DIR on a persistent private volume.');
  if (!/^[0-5]$/.test(env.TRUST_PROXY_HOPS || ''))
    throw new Error('Production requires TRUST_PROXY_HOPS as an explicit integer from 0 to 5.');
  for (const key of ['MODERATION_SECRET', 'ADMIN_PASSWORD'])
    if ((env[key]?.length || 0) < 32)
      throw new Error(`${key} must contain at least 32 random characters.`);
  if (!env.ADMIN_USERNAME?.trim() || env.ADMIN_USERNAME.length > 100)
    throw new Error('Production requires ADMIN_USERNAME (1 to 100 characters).');
  if (env.ADMIN_PASSWORD === env.MODERATION_SECRET)
    throw new Error('Admin and moderation secrets must be different.');
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.length < 32)
    throw new Error('ADMIN_TOKEN must contain at least 32 random characters when configured.');
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN === env.MODERATION_SECRET)
    throw new Error('Admin and moderation secrets must be different.');
}

export const metrics = {
  requests: 0,
  errors: 0,
  rateLimited: 0,
  rejectedOrigins: 0,
  providerFailures: 0,
  startedAt: Date.now(),
};

/** Accept only explicit fields; never serialize an Error, URL, request, IP, or payload. */
export function logEvent(
  event: string,
  fields: { status?: number; durationMs?: number; requestId?: string; method?: string } = {},
) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

export function securityMiddleware(options: {
  origin?: string;
  production: boolean;
  adminToken?: string;
  testRateScale?: number;
}): RequestHandler {
  const limiter = new WindowLimiter();
  const scale = options.testRateScale || 1;
  return (req, res, next) => {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(self), geolocation=(), payment=(), autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")',
    );
    const scripts =
      "'self' https://www.youtube.com https://s.ytimg.com" +
      (options.production ? '' : " 'unsafe-inline'");
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com; media-src 'self' blob: data:; font-src 'self'; connect-src 'self' ${options.production ? '' : 'ws: wss:'}; frame-src https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
    );
    if (options.production)
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      metrics.requests++;
      if (res.statusCode >= 500) metrics.errors++;
      if (res.statusCode >= 500)
        logEvent('request_failed', {
          requestId,
          method: req.method,
          status: res.statusCode,
          durationMs: Date.now() - started,
        });
    });
    const origin = options.origin || `${req.protocol}://${req.get('host')}`;
    const administrative =
      req.path.startsWith('/api/admin/') &&
      constantTimeEqual(req.get('authorization') || '', 'Bearer ' + (options.adminToken || '')) &&
      !!options.adminToken;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        !administrative &&
        (req.get('origin') !== origin || req.get('sec-fetch-site') === 'cross-site')
      ) {
        metrics.rejectedOrigins++;
        return res.status(403).json({ error: 'This action must originate from CourseMates.' });
      }
      if (!req.is('application/json'))
        return res.status(415).json({ error: 'Send an application/json request.' });
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const group =
      req.path.startsWith('/api/auth/') && req.path !== '/api/auth/session'
        ? 'auth'
        : req.path.startsWith('/api/ai/')
          ? 'ai'
          : req.path === '/api/music/search'
            ? 'search'
            : 'api';
    const limit = { auth: 30, ai: 30, search: 30, api: 1200 }[group] * scale;
    if (!limiter.take(`${group}:${key}`, limit, 60000)) {
      metrics.rateLimited++;
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    }
    next();
  };
}

export function requireObjectBody(): RequestHandler {
  return (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    )
      return res.status(400).json({ error: 'Expected a JSON object.' });
    next();
  };
}

export function validateAiInput(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid request.');
  const body = value as Record<string, unknown>;
  for (const key of ['topic', 'discipline', 'campus', 'query', 'action', 'message']) {
    const item = body[key];
    if (
      item !== undefined &&
      (typeof item !== 'string' || item.length > (key === 'message' ? 4000 : 2000))
    )
      throw new Error(`Invalid ${key}.`);
  }
  if (
    body.action !== undefined &&
    !['summarize', 'explain', 'suggest', 'nudge'].includes(String(body.action))
  )
    throw new Error('Invalid action.');
  for (const key of ['recentMessages', 'chatHistory']) {
    const history = body[key];
    if (history === undefined) continue;
    if (
      !Array.isArray(history) ||
      history.length > 20 ||
      history.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          typeof item.text !== 'string' ||
          item.text.length > 4000 ||
          (item.isMe !== undefined && typeof item.isMe !== 'boolean') ||
          (item.senderHandle !== undefined &&
            (typeof item.senderHandle !== 'string' || item.senderHandle.length > 100)),
      )
    )
      throw new Error('Invalid conversation context.');
    // Prevent arbitrary nested objects and peer-supplied URLs reaching a provider.
    body[key] = history.map((item) => ({
      text: item.text,
      isMe: item.isMe === true,
      ...(typeof item.senderHandle === 'string' ? { senderHandle: item.senderHandle } : {}),
    }));
  }
}

/** Bounds external work; repeated failures open a short circuit instead of queuing calls. */
export function providerGuard(maxConcurrent = 8, now: () => number = Date.now): RequestHandler {
  let active = 0,
    failures = 0,
    reopenAt = 0;
  return (_req, res, next) => {
    if (active >= maxConcurrent || now() < reopenAt) {
      res.setHeader('Retry-After', '30');
      return res
        .status(503)
        .json({ error: 'This optional service is busy. Please try again shortly.' });
    }
    active++;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      active--;
      if (res.statusCode >= 500) {
        metrics.providerFailures++;
        if (++failures >= 5) {
          reopenAt = now() + 30000;
          failures = 0;
        }
      } else failures = 0;
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  };
}
