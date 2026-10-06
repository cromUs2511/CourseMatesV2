# CourseMates development guide

CourseMates is an anonymous peer-matching study chat. The supported product
path is React/Vite in `src/`, Express in `server.ts`, and the in-memory runtime
in `runtime.ts`. The live WebSocket endpoint is `/ws/chat`; Render supports the
upgrade and REST polling remains the reconnect fallback.

Repo: `github.com/cromUs2511/CourseMatesV2`, default branch `main`. Commits use
conventional prefixes (`feat:`, `fix:`, `style:`, `chore:`, `build(native):`).

## Commands

- `npm run dev` — Vite middleware plus the Express runtime on port 3000.
- `npm test` — Node runtime and utility regression suite (`node:test` over
  `tests/*.test.ts`).
- `npm run typecheck` — strict TypeScript only (`tsc --noEmit`).
- `npm run lint` — `typecheck` plus ESLint over every `*.ts`/`*.tsx`.
- `npm run format:check` / `npm run format` — Prettier gate and writer.
- `npm run test:coverage` — the unit suite under c8 with the thresholds in
  `.c8rc.json`.
- `npm run test:python` — Python shadow-service contracts.
- `npm run build` — Vite client and production Express bundle.
- `npm start` — run `dist/.server/server.cjs`; never launches Vite or Python.
- `npm run test:e2e` — production-mode Playwright suite. Build first.
- `npm run test:e2e:dev` — the same suite against Vite dev mode.
- `npx playwright test --config playwright.drawing.config.ts` — only
  `drawing.spec.ts`, in WebKit (the Safari engine). `PW_BROWSER=webkit` runs the
  whole suite in WebKit. Neither is wired into `package.json` or CI.
- `npm run clean` — remove `dist/` and `server.js`.
- `docker compose up --build` — Node edge plus the Python orchestrator.

CI (`.github/workflows/ci.yml`) runs all of the above plus a browser matrix,
`npm audit`, the ASan/UBSan native smoke build, and both container images. The
operational runbook is `docs/operations.md`.

## Layout

- `server.ts` — Express bootstrap, env loading, music and AI routes, static/Vite
  serving. `runtime.ts` — sessions, queue, rooms, matching, all
  `/api/auth|match|chat/*` routes, `/api/health`, and the WebSocket server.
- `chatImages.ts`, `voiceMessages.ts` — server-side media validation.
  `pythonOrchestrator.ts` — non-throwing shadow client.
- `safety.ts` — `SafetyStore` (reports, blocks, bans; the only durable data) and
  `moderateText`, driven by `moderation-patterns.json`. `serverSecurity.ts` —
  `WindowLimiter`, `constantTimeEqual`, `metrics` and the production config gate.
- Peer games, one server module each, all mounted from `runtime.ts`:
  `ticTacToe.ts`, `rps.ts`, `connectFour.ts`, `chess.ts` (chess.js),
  `trivia.ts`, `wouldYouRather.ts`, `drawGuess.ts` (prompt bank in
  `drawGuessPrompts.ts`, server-only), and `uno.ts` / `unoTypes.ts`. Matching UI
  is `src/components/Peer*.tsx`, `Uno*.tsx`, `DrawingCanvas.tsx`, with shared
  catalog data in `src/data/peerGames.ts`.
- `UNO.txt` (standalone HTML prototype) and `todo` (a game-repair task brief)
  are scratch files, not part of the product.
- `src/data/` is imported by both the browser and the server, so shared limits
  and validators (`chatImages.ts`, `chatVoice.ts`, `chatMedia.ts`,
  `reactions.ts`, `musicSnippet.ts`, `drawGuess.ts` types and palette) live in
  one place. Change a limit there, not in a copy.
- `tests/` (`node:test`), `tests/browser/` (Playwright),
  `services/python-orchestrator/`, `native/`, `native_bridge.py`, and
  `docs/architecture/` (read before touching Python). `docs/operations.md` is the
  runbook; `docs/superpowers/{specs,plans}/` hold dated design and verification
  notes (Draw & Guess, the Python shadow service, production readiness).
- `scripts/export-task-list-pdf.mjs` is a one-off that prints
  `docs/CourseMates-Initial-Task-List.html` (not in the repo) with a hard-coded
  Windows Chrome path. It is not part of any workflow.
- `metadata.json` is a Google AI Studio manifest, unused at runtime.

## Configuration

Env loads from `.env.groq.local`, `.env.gemini.local`, `.env.local`, then
`.env`; variables already in the process win. `.env*` is git-ignored except
`.env.example`. Never commit real credentials.

- `APP_URL` sets the expected WebSocket `Origin` and whether the session cookie
  is `Secure`. Set it behind an HTTPS proxy.
- `ALLOW_ANONYMOUS_ACCESS` is on unless it is exactly `false`.
- `GEMINI_API_KEY` (alias `Gemini_AI`; the placeholder `MY_GEMINI_API_KEY` is
  ignored). `GEMINI_MODEL` defaults to `gemini-3.6-flash`, and the retired
  `gemini-2.5-flash` is silently upgraded to it.
- `GROQ_API_KEY` / `GROQ_MODEL` (default `groq/compound`) are used only when
  Gemini is not configured.
- Without `YOUTUBE_API_KEY`, `/api/music/search` returns 503 and the server logs
  a `[config]` warning at startup.
- `CHAT_MULTIPLAYER_V2` is on unless exactly `false`. Off, every peer-game route
  returns 503 and music falls back to play/pause only; the legacy UNO arena
  endpoints are restored instead.
- `TRUST_PROXY_HOPS` (0–5, default 0) is the number of proxies in front; Render
  is 1. `ADMIN_USERNAME` (default `admin`) and `ADMIN_PASSWORD` sit beside
  `ADMIN_TOKEN` for the dashboard. `SUPPORT_EMAIL` is surfaced by
  `/api/public-config`.
- `CHAT_MEDIA_LOCK_MS=0` is honored only when `NODE_ENV=test`; Playwright sets it
  so photo tests don't wait out the 90 s media lock.
- `PYTHON_ORCHESTRATOR_MODE` (`off` | `shadow`), `_URL` (default
  `http://127.0.0.1:5051`), `_TIMEOUT_MS` (default 500, clamped to 50–5000).
- `CM_DISABLE_NATIVE=1` forces the pure-Python fallback. `DISABLE_HMR=true`
  turns off Vite HMR and file watching.
- `NODE_ENV=production` (or `--production`) additionally requires `APP_URL`,
  `SINGLE_INSTANCE=true`, `DATA_DIR`, `MODERATION_SECRET` and `ADMIN_TOKEN`;
  the process exits at startup without them. `WEB_CONCURRENCY` must be unset or
  `1`.

## Authentication and state

External Microsoft/Entra authentication has been removed. Anonymous access is
enabled by default and can be disabled with `ALLOW_ANONYMOUS_ACCESS=false`.
Sessions use the `cm_session` HttpOnly cookie and bearer token compatibility
path. Queue, room, message, media, revision, and socket state remain in the
single Node process until a replacement proves parity.

Legacy email sign-in (`POST /api/auth/school-email`, alias `/verify-school`)
returns 410: CourseMates never verifies student identities. Sessions come from
`POST /api/auth/anonymous` with an accepted 18+ terms flag and last eight
hours. Peers see a separate public `sessionId` and generated handle, never
another participant's token or email.

## Runtime behavior

- **Matching** (`join` in `runtime.ts`): interest text is split into lower-cased
  words, minus one-letter words and a stop-word list; `General Peer Discovery`
  is ignored. Score is shared words, plus 100 for an exact interest match.
  Highest score wins, ties go to the earliest queued. With no match, someone
  who set `allowNormal` (or has only the generic interest) pairs with the first
  queued peer who also allows it; otherwise they queue. `verified` is always
  `false`.
- **Liveness:** a queue entry silent for 30 s is dropped by a 5 s cleanup
  timer, and a room where every member has been silent for 30 s is abandoned
  and frees its messages and media, so one backgrounded peer never ends the
  chat for the peer who stayed. Polling or
  a WebSocket `ping` refreshes it. A dropped socket does not end a room. One
  socket per session; a new one closes the old. A live Draw & Guess turn (and
  its final results) survives until its server deadline plus 30 s even if both
  phones sleep; an explicit leave still purges the room immediately.
- **Reconnect:** the client saves the live chat in `localStorage`
  (`cm_active_chat`, `utils/chatReconnect.ts`) so a reloaded or backgrounded tab
  rejoins the same room. An expired session cannot rejoin its old room.
- **Messages:** at most 4,000 characters, latest 500 kept per room, and
  evicting one frees its media. Delete turns a message into `Message unsent.`;
  only the sender can delete or edit, and only text can be edited. A repeated
  `clientMessageId` returns the earlier message. Every room mutation bumps
  `room.revision`, which clients send when polling.
- **Media** is sent over `POST /api/chat/send` (7 MB body limit; all other JSON
  is 64 KB), never the socket. Images: up to 4 per message, JPEG/PNG/WebP/GIF,
  1600 px max, a 24 MB budget per room. One voice message per send, up to 3
  minutes. Exact limits are in `src/data/chatImages.ts` and `chatVoice.ts`;
  the server checks magic bytes and rejects non-canonical base64. Photos and
  voice are locked for the first 90 s of a room (`room.mediaUnlockAt`,
  `CHAT_MEDIA_LOCK_MS`); text and music snippets are not.
- **Music:** a **music snippet** is a message carrying a 15–30 s YouTube window
  (`musicSnippet`, validated by `normalizeMusicSnippet`; only a YouTube id, never
  a peer-supplied image URL). It is moderated, cannot be edited, and must be sent
  without photos or voice. Separately, a room has shared playback state
  (`POST /api/chat/music`, `/api/chat/music/next` with a `revision` check) shown
  by `TopMusicBar.tsx`. `server.ts` owns `/api/music/search` (YouTube) and
  `/api/music/directory`. Tracks matching Spider-Man/Spider-Verse soundtrack
  titles in `musicDirectory.ts` switch the room to a web background.
- **Reactions:** `POST /api/chat/react` with the fixed emoji set in
  `src/data/reactions.ts`.
- **AI:** `server.ts` owns `/api/ai/*`. Gemini first, Groq only if Gemini is
  absent, static icebreakers if neither. Grounding is enabled only for
  explicitly current or online questions. The chatbot is a labelled simulation
  (`isSimulated` on `ActivePeerInfo`).
- All `/api/*` responses are `no-store`, and unknown paths return a JSON 404.

## Peer games

Eight games: UNO, Tic-Tac-Toe, Rock Paper Scissors, Connect Four, Chess,
Trivia, Would You Rather, Draw & Guess.

- Routes are `GET|POST /api/chat/{tictactoe,rps,connectfour,chess,trivia,wyr,drawing}`
  (invite, respond, move) and `/api/uno/*` (arena, challenge, action, away,
  leave). Both are rate limited (429) and can return 503 when games are
  disabled.
- Only one non-UNO peer game, or an in-room UNO table, may be live per room.
  New ones go through `assertRoomGameFree`; a game with a `result` no longer
  blocks.
- State is server-authoritative and synced over WebSocket with REST fallback,
  like chat. Never send a player's hidden state (UNO hands, unrevealed Would You
  Rather choices) to the peer.
- Chess boards must come from `chess.board()`, not from parsing chess.js ASCII
  output.
- Every game posts a leave notice to the chat timeline exactly once
  (`postGameLeaveNotice`), and a finished game frees the room slot.
- **Draw & Guess** (`drawGuess.ts`, spec in
  `docs/superpowers/specs/2026-10-03-draw-and-guess-design.md`): six alternating
  turns, three private prompt choices (auto-picked after 20 s), 60 s to draw,
  guesses scored on the server (100 each, plus up to 60 time bonus), and a mutual
  rematch. Serialize state per viewer with `serializeFor(id)`; the answer and
  unchosen choices must not reach the wrong peer, so never broadcast one common
  state. Strokes are vectors in an 800 × 500 space with the batch, stroke and
  canvas caps in the spec; clear bumps a canvas version so late batches can't
  undo it. The bank has 1,100 prompts (10 categories × 40 easy/40 medium/30 hard);
  keep the counts when adding. `DrawingCanvas.tsx` uses Pointer Events, and
  `PeerDrawGuess.tsx` sends strokes serially so latency can't reorder them.
- Tests: `tests/uno.test.ts`, `peerGames.test.ts`, `peer-games-repair.test.ts`,
  `drawGuess.test.ts`, `drawGuessRuntime.test.ts`, `gameLeaveNotice.test.ts`,
  `game-auto-terminate.test.ts`, and `tests/browser/games.spec.ts` /
  `uno.spec.ts` / `drawing.spec.ts`.

## Safety, moderation and admin

- Users report and block via `POST /api/safety/<action>`. Browser ids are
  HMAC-hashed with `MODERATION_SECRET` into a 64-hex actor; no message text,
  email or token is stored. Reports keep the IP for 30 days; permanent IP bans
  do not expire.
- `SafetyStore` persists to `DATA_DIR/moderation.json` (atomic write, symlinks
  and bad secrets rejected). A storage error disables it until restart.
- `/api/admin/*` (login, session, metrics, reports, moderate) uses an
  `ADMIN_TOKEN`-backed HttpOnly cookie scoped to `/api/admin`, rendered by
  `AdminDashboard.tsx`. Compare secrets with `constantTimeEqual`.
- `moderateText` filters outgoing text using `moderation-patterns.json`. The
  static pages `public/{privacy,terms,community}.html` back the 18+ terms flag.

## Frontend

`App.tsx` drives Access → Matchmaking → Chat and restores the session from
`/api/auth/session`. `MatchmakingQueue.tsx` opens the WebSocket and polls
`/api/match/poll` as a fallback; `ChatRoom.tsx` polls messages about every 1.5 s.
`apiRequest` in `utils/api.ts` sends `credentials: 'same-origin'` so the
HttpOnly cookie carries the session (no bearer header), applies a 20 s timeout,
and throws the JSON `error` text. The `@` alias points at the project root, not
`src/`.
Every `localStorage` access is wrapped in try/catch (storage can be
unavailable), and animations must honor reduced-motion. Viewport height is
tracked through `--app-height` / `--app-top` for mobile keyboards.

- **Appearance:** light/dark (`coursemates_darkmode`, toggled with a View
  Transition reveal in `utils/themeTransition.ts`) and one of fifteen chat color
  themes (`coursemates_chat_theme`, `ChatThemeMenu.tsx`). The theme picker must
  keep every label inside a 320 px viewport. Sound has its own toggle
  (`utils/sound.ts`), and `AmbientAurora.tsx` follows music and glow settings.
- **Conversation starters:** the chat offers at most three, which expire after
  75 s; they never limit normal messages.
- Each game's CSS lives beside it (`uno.css`, `tictactoe.css`, `connectfour.css`,
  `drawing.css`, `matching-chat.css`).

## Testing

- `runtime.test.ts` mounts `attachRuntime` on an ephemeral port and drives it
  with real `fetch` and `ws` clients; `issueSession` skips the sign-in route.
- Playwright runs one worker against an isolated server on port 3100 with
  `NODE_ENV=test`, `LOAD_LOCAL_ENV=false` and every AI/YouTube key cleared, so
  a local `.env*` credential can never reach a test server. It runs the built
  bundle, so `npm run build` first or use `test:e2e:dev`. Pick the browser with
  `PW_CHANNEL` (default `chrome`).
- `tests/browser/accessibility.spec.ts` runs axe-core plus keyboard/focus
  checks over the access gate, matchmaking screen and chat room.
- `tests/load.test.ts` and the flood test in `tests/security.test.ts` hold the
  capacity, rate-limit and drain behaviour.
- Run `npm run lint`, `npm run format:check` and `npm test` before calling a
  change done. `npm run dev` fails with `EADDRINUSE` if port 3000 is taken.
- Run Node suites serially on Windows; parallel Node and WebKit runs produced
  local HTTP delays and resets.
- Emulated touch/mobile contexts are not real-device testing. Do not claim
  Android, iOS or physical-keyboard coverage from Playwright alone.
- Known gaps recorded in `docs/superpowers/plans/2026-10-03-draw-and-guess-verification.md`
  (2026-10-03): the full production Chrome suite was not green (legacy failures
  in music preferences, REST Tic-Tac-Toe recovery, header sizing, mobile layouts,
  backreading and music queues; only three were reproduced on the pre-feature
  revision), and `format:check` flagged 18 files including `CLAUDE.md` itself.
  Re-run before assuming either has been fixed.

## Layered migration

`services/python-orchestrator/` is the only supported Python service. It is
disabled by default and can run in `PYTHON_ORCHESTRATOR_MODE=shadow`; shadow
requests are non-blocking and cannot change public behavior. Its matcher
implements the current Node selection rule only for comparison. `native/` is a
C++17 pybind11 module used only through Python once parity and performance
benefit are demonstrated.

Do not replace `runtime.ts`, alter public REST/WebSocket payloads, or remove
the REST recovery path without contract tests, side-by-side validation, and a
reversible rollout flag.

- **Shadow service:** FastAPI, contract version 1, no `enforce` mode, and no
  session, room, queue, or socket state. Node calls it fire-and-forget
  (`observeMatch` in `join()`, `observeIcebreakers` on the no-AI path) and
  discards the result and any error. Keep `app/matching.py` in step with
  `sharedInterest` and the stop words in `runtime.ts`, or parity checks
  become meaningless.
- **Native module:** build with `pip install ./native` (C++17, CMake 3.18+,
  Python 3.10+). Test in order: `tests/smoke.cpp`, `pytest
native/tests/test_native.py`, `native/tests/bench.py`. Import through
  `native_bridge.py`, never `coursemates_native` directly. Blocking methods must
  keep `py::call_guard<py::gil_scoped_release>`. Nothing in `native/src/` may
  own memory manually. Only the content filter is a real speedup; do not claim
  one for the rate limiter. Never ship a `-DCM_SANITIZE=ON` wheel. On Windows
  prefer MSVC; `CMakeLists.txt` static-links the MinGW runtime so a MinGW
  `.pyd` imports without GCC DLLs on `PATH`. Details: `native/README.md`.
- **Containers:** the root `Dockerfile` builds only the Node edge. The Python
  image (3.12) compiles the C++ module. Compose waits on the Python health
  check, then starts web in `shadow` mode.

## Deployment and privacy

The runtime is **single process**: a restart clears every session and room, and
a second replica or extra uvicorn worker would hold a separate queue. Do not
scale out until a shared store and coordinated expiry exist. Chat messages and
media are RAM-only, and `runtime.ts` never logs them; keep it that way.
Conversation starters send only topic, campus, and discipline to Gemini. If the
native filter is wired in, aggregate categories, never message text.

## Retired code

The former Python REST/realtime prototypes and one-off UI patch scripts were
removed. Do not restore or route product traffic through them.
