# CourseMates operations runbook

This is the operational companion to `README.md` and `CLAUDE.md`. It covers how
the service is configured, gated, observed, recovered, and what is explicitly
_not_ verified yet.

## 1. Architecture invariants

Do not change these without contract tests, side-by-side validation, and a
reversible rollout flag.

- **One Node process owns everything.** Sessions, the matching queue, rooms,
  messages, media, revisions and sockets live in `runtime.ts` memory. There is
  no shared store, so a second replica or a second uvicorn worker holds a
  separate queue.
- **Chat data is ephemeral by design.** A restart clears every session and
  room. This is a product decision, not a bug.
- **Moderation data is durable.** Reports, blocks and bans are the only
  records that survive a restart, in `DATA_DIR/moderation.json`.
- **Node owns the public contract.** The Python orchestrator is shadow-only and
  `PYTHON_ORCHESTRATOR_MODE=off` by default; its responses are discarded. The
  C++ module is reached only through `native_bridge.py`.
- **REST polling is the recovery path.** Losing the WebSocket never ends a
  room; clients fall back to `GET /api/chat/messages`.

## 2. Configuration

Env files load in this order — `.env.groq.local`, `.env.gemini.local`,
`.env.local`, `.env` — and values already present in the process environment
win. Set `LOAD_LOCAL_ENV=false` to skip them entirely (the browser test server
does this on purpose). Never commit real credentials.

### Fail-closed production gate

`validateProductionConfig` in `serverSecurity.ts` runs at startup when
`NODE_ENV=production` (or `--production`) and exits the process if:

| Check                                                                                    | Failure message                                                                                                        |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `APP_URL` parses and is `https://` with no path/query/hash/credentials                   | `Production requires APP_URL with an HTTPS origin.` / `APP_URL must be an HTTPS origin without a path or credentials.` |
| `SINGLE_INSTANCE=true`, `WEB_CONCURRENCY` unset or `1`, `NODE_APP_INSTANCE` unset or `0` | `This ephemeral runtime requires SINGLE_INSTANCE=true and exactly one process/replica.`                                |
| `DATA_DIR` set                                                                           | `Production requires DATA_DIR on a persistent private volume.`                                                         |
| `TRUST_PROXY_HOPS` is an explicit integer from `0` to `5`                                | `Production requires TRUST_PROXY_HOPS as an explicit integer from 0 to 5.`                                             |
| `MODERATION_SECRET` and `ADMIN_PASSWORD` each ≥ 32 chars; `ADMIN_USERNAME` is set        | `<KEY> must contain at least 32 random characters.`                                                                    |

`APP_URL` also sets the expected WebSocket `Origin` and whether cookies are
`Secure`. Behind Render's proxy, set `TRUST_PROXY_HOPS=1` so the server records
the connecting user's IP rather than Render's proxy address. Verify this setting
against your deployment's proxy topology before enabling IP restrictions.
Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Render's environment settings;
use a fresh password with at least 32 random characters, and rotate any password
that has been shared outside the secret manager. Visit `/admin` to sign in;
the dashboard uses a short-lived HttpOnly cookie and does not put credentials
in the URL.

### Other switches

- `ALLOW_ANONYMOUS_ACCESS` — on unless it is exactly `false`.
- `GEMINI_API_KEY` (alias `Gemini_AI`; `MY_GEMINI_API_KEY` is ignored),
  `GEMINI_MODEL` (default `gemini-3.6-flash`).
- `GROQ_API_KEY` / `GROQ_MODEL` — used only when Gemini is absent.
- `YOUTUBE_API_KEY` — without it `/api/music/search` returns 503 and the
  server logs `[config] youtube_search_disabled` at startup.
- `PYTHON_ORCHESTRATOR_MODE` (`off` | `shadow`), `_URL`, `_TIMEOUT_MS`
  (default 500, clamped 50–5000).
- `CM_DISABLE_NATIVE=1` forces the pure-Python fallback; `DISABLE_HMR=true`
  turns off Vite HMR.

`.env.example` documents every variable.

## 3. Release gates

Local, before calling any change done:

```bash
npm ci
npm run lint            # tsc --noEmit + eslint
npm run format:check    # prettier
npm run test:coverage   # node:test suite under c8, thresholds in .c8rc.json
npm run test:python     # FastAPI shadow-service contracts
npm run build
npm run test:e2e        # production bundle, needs a build first
npm run test:e2e:dev    # same suite against the Vite dev server (StrictMode + unminified CSS)
```

Native (optional, requires a C++17 compiler):

```bash
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -I native/src native/tests/smoke.cpp -o smoke && ./smoke
pip install ./native
python -m pytest -p no:cacheprovider native/tests/test_native.py -q
python native/tests/bench.py
```

CI (`.github/workflows/ci.yml`) runs the same gates plus:

- browser matrix over `chrome` and `chromium` (`PW_CHANNEL`),
- `npm audit --audit-level=high`,
- the ASan + UBSan build of `native/tests/smoke.cpp`,
- both container images and `docker compose config`.

Coverage thresholds live in `.c8rc.json` (65% lines/statements/functions, 55%
branches). Configuration and prose are checked by their consumers, not by a
coverage number.

## 4. Observability

### Health

| Endpoint                                  | Meaning                                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`, `GET /api/health/live` | Liveness. Always 200 while the process runs, including during drain.                                                                    |
| `GET /api/health/ready`                   | Readiness. 503 while draining or when the moderation store cannot be read; 200 otherwise. This is what the container health check uses. |

### Private metrics

`GET /api/admin/metrics` requires an authenticated admin session or the optional legacy `ADMIN_TOKEN` Bearer credential and returns only counters: `requests`, `errors`, `rateLimited`, `rejectedOrigins`, `providerFailures`, `startedAt`, plus `sessions`, `queued`, `rooms`, `sockets`, `mediaBytes`, `draining` and `memory` (RSS).

It never contains chat text, media, tokens, emails, IPs or report bodies. `GET /api/admin/reports` returns report metadata (category, optional reporter note, anonymous actor identifiers and handles, topic, reported IP, status, timestamps, conversation message count, triage score, attached photo count), plus active actor/IP restrictions. `GET /api/admin/reports/:id` returns one report with its recent text conversation excerpt (up to 50 messages, no photo/voice bytes), its admin decision history, its triage flag, and attached photo fingerprints with their ban state. `GET /api/admin/images` lists banned photo fingerprints. `GET /api/admin/actions` returns the audit trail, optionally filtered by report. Reports, excerpts, and decisions retain for up to 30 days. `POST /api/admin/moderate` resolves, dismisses, or escalates reports (optional decision note), applies 1-, 2- or 3-day restrictions or permanent actor/IP bans, and lifts bans. The dashboard lists active restrictions separately so permanent bans can still be lifted after the originating report expires.

### Logs

`logEvent` writes one JSON line with an explicit field allowlist. It must
never serialize an `Error`, `URL`, request, IP or payload, and `runtime.ts`
must never log message or media contents.

## 5. Limits

| Limit                                       | Value                                                                          | Where                  |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| JSON body (non-media)                       | 64 KB                                                                          | `server.ts`            |
| Chat send body (media)                      | 7 MB                                                                           | `CHAT_SEND_BODY_LIMIT` |
| Message text                                | 4,000 chars, 500 kept per room                                                 | `runtime.ts`           |
| Photos                                      | 4 per message, 1 MB each (3 MB GIF), 4 MB per message, 1600 px, 24 MB per room | `chatImages.ts`        |
| Voice                                       | 4 MB, 180 s, one per send                                                      | `chatVoice.ts`         |
| Rate limit (per IP, per minute)             | auth 30, ai 30, search 30, other api 1200                                      | `securityMiddleware`   |
| WebSocket upgrades                          | 120/min per remote address                                                     | `runtime.ts`           |
| WebSocket messages                          | 240/min per session; closes with `Rate limit exceeded`                         | `runtime.ts`           |
| Sessions / rooms / queued / sockets / media | 2000 / 500 / 1000 / 2000 / 128 MB                                              | `defaultLimits`        |
| Session lifetime                            | 8 hours                                                                        | `issueSession`         |
| Peer inactivity                             | 30 s drop when every room member is silent, swept every 5 s                    | cleanup interval       |
| AI provider concurrency                     | 8 in flight, 5 failures open a 30 s circuit                                    | `providerGuard`        |
| HTTP timeouts                               | request 30 s, headers 15 s, keep-alive 5 s, 100 headers                        | `server.ts`            |

Rate-limited responses carry `Retry-After: 60`. Saturation fails closed: the
`WindowLimiter` never evicts an active key to make room for a new one.

## 6. Moderation storage

- Paths: `$DATA_DIR/moderation.json` (report metadata, blocks, bans) and
  `$DATA_DIR/moderation.db` (SQLite: reported conversation excerpts plus the
  admin decision trail). `MODERATION_DB_PATH` overrides the database file.
  Without `DATA_DIR` both stores are memory-only and do not survive a restart.
- Format: versioned JSON written atomically (temp file + rename) plus SQLite
  with a `schema_migrations` table (`moderationDb.ts` runs `CREATE TABLE IF
NOT EXISTS` on startup, so fresh volumes self-initialize and existing files
  migrate in place; legacy `moderation.json` files load without the newer
  `roomId`/`topic`/`reason`/handle/status fields). A failed write keeps the
  last committed file.
- Corruption, a symlink, an oversized file, unknown keys, a bad category, a
  self-target, an out-of-range duration or an incompatible version all **fail
  closed**: the store refuses the record rather than trusting it.
- Retention: 30 days (`SAFETY_RETENTION_MS`), swept on write and on the 5 s
  maintenance timer. Capacity is 10,000 records by default and a per-reporter
  daily cap applies. Conversation excerpts keep text only (up to 50 messages,
  photos/voice stored as placeholders, never bytes).
- Report statuses: `open`, `resolved`, `dismissed`, `escalated`. Categories:
  `harassment`, `spam`, `sexual`, `threats`, `other`. A report may flag one
  peer message (`messageId`) or the whole chat; single-message excerpts center
  on the flagged message. Reports may also carry SHA-256 fingerprints of peer
  photos (`report_image_hashes`); image bytes are never stored.
- Photo safety is two layers. Outgoing photos are pre-screened on the reporter's
  own device (`src/data/imageNudity.ts`, canvas decode in `prepareChatImage.ts`):
  blatant full-frame skin exposure cannot attach. It is conservative by design
  (small images, grayscale, and ordinary portraits always pass) and bypassable
  by a determined client, so confirmed photos are banned by fingerprint instead:
  `POST /api/admin/moderate` with `banImage`/`unbanImage` maintains the
  `banned_image_hashes` denylist, enforced for every sender in `send()` before
  the media lock. Fingerprint bans persist until lifted.
- Automatic triage (`autoModeration.ts`, deterministic, no external calls):
  every report is scored 0–100 from the existing content filter plus
  behavioral signals (spam bursts, repetition, category prior, target
  history). The score, label (`low`/`medium`/`high`/`critical`), and per-signal
  weights persist in the `auto_flags` table and surface in the dashboard.
  Scores at or above `AUTO_MOD_ESCALATE_SCORE` (default 80, `0` disables)
  auto-escalate the report with an `auto-triage` audit entry. Triage never
  bans or restricts anyone; every enforcement decision stays human.
- Anonymous actor IDs are HMAC-derived from `MODERATION_SECRET`. Rotating the
  secret invalidates every existing ban, so treat it like a signing key.

**Backup:** copy `$DATA_DIR/moderation.json` and `$DATA_DIR/moderation.db`
while the process is stopped, or snapshot the volume. **Restore:** put both
files back and restart; a parse failure is logged and the store starts empty
rather than crashing.

## 7. Shutdown and recovery

`SIGTERM`/`SIGINT` → `server_draining` → `stopRuntime()`:

1. `draining` flips to `true`; new joins and WebSocket upgrades are refused
   with 503, and `/api/health/ready` reports `draining`.
2. Every open socket receives `server_restart` and is closed with code 1012.
3. Every room is torn down, then the queue, sessions, identities and socket
   maps are cleared — media bytes included, so RSS is released.
4. The HTTP server closes; a 2 s hard exit is armed as a backstop.

Because chat state is ephemeral, **recovery is "users start over"**: clients
return to anonymous entry and re-match. Moderation records are the only thing
restored. Never add a second replica to "fix" a restart — that silently splits
the queue.

## 8. Scaling and platform notes

- One process, one replica, one host. `docker compose` pins `replicas: 1`,
  `mem_limit: 768m`, `pids_limit: 128`, `read_only: true`, `cap_drop: [ALL]`.
- Horizontal scaling requires a shared session/queue store plus coordinated
  expiry first. Until then a second instance is a second, invisible queue.
- Put the service behind an HTTPS proxy and set `APP_URL` plus
  `TRUST_PROXY_HOPS`; otherwise the origin check and `Secure` cookies are
  wrong and sign-in breaks.
- The container user is unprivileged and `/app/data` is the only writable path.

## 9. Known verification gaps

Recorded honestly; none of these may be described as production-ready:

- **ASan/UBSan of the Python extension.** The CI job sanitizes
  `native/tests/smoke.cpp`. Running the _pybind11 module itself_ under ASan
  needs an instrumented interpreter and is not wired up.
- **Windows sanitizer run.** No ASan/UBSan runtime is available in the local
  MinGW toolchain, so the sanitizer gate only runs in Linux CI.
- **Container build/run locally.** Docker is not available on every
  workstation; `docker build` and `docker compose config` run in CI only.
- **Load beyond the rate-limiter tests.** There is no sustained multi-client
  soak test — only bounded flood, capacity and drain tests.
- **Real device camera/microphone hardware.** Browser tests mock or request
  permissions; they do not exercise physical hardware.
- **Third-party accessibility audit.** Automated axe-core coverage of the
  access gate, matchmaking screen and chat room is in place; manual screen
  reader and zoom testing has not been done.
- **External penetration review.** Everything here is self-verified by the
  test suite.
