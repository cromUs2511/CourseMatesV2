# CourseMates development guide

CourseMates is an anonymous peer-matching study chat. The supported product
path is React/Vite in `src/`, Express in `server.ts`, and the in-memory runtime
in `runtime.ts`. The live WebSocket endpoint is `/ws/chat`; Render supports the
upgrade and REST polling remains the reconnect fallback.

Repo: `github.com/cromUs2511/CourseMatesV2`, default branch `main`. Commits use
conventional prefixes (`feat:`, `fix:`, `style:`, `chore:`, `build(native):`).

## Commands

- `npm run dev` — Vite middleware plus the Express runtime on port 3000.
- `npm test` — Node runtime and utility regression suite. One file:
  `npx tsx --test tests/runtime.test.ts`.
- `npm run lint` — TypeScript checks (`tsc --noEmit`). There is no ESLint or
  Prettier; type-checking is the whole lint step.
- `npm run build` — Vite client and production Express bundle.
- `npm start` — run `dist/.server/server.cjs`; never launches Vite or Python.
- `npm run test:e2e` — production-mode Playwright suite. Build first.
- `npm run test:e2e:dev` — the same suite against Vite dev mode.
- `npm run clean` — remove `dist/` and `server.js`.
- `python -m pytest -p no:cacheprovider services/python-orchestrator/tests/test_main.py -q` — Python shadow-service contracts.
- `docker compose up --build` — Node edge plus the Python orchestrator.

## Layout

- `server.ts` — Express bootstrap, env loading, music and AI routes, static/Vite
  serving. `runtime.ts` — sessions, queue, rooms, matching, all
  `/api/auth|match|chat/*` routes, `/api/health`, and the WebSocket server.
- `chatImages.ts`, `voiceMessages.ts` — server-side media validation.
  `pythonOrchestrator.ts` — non-throwing shadow client.
- `src/data/` is imported by both the browser and the server, so shared limits
  (`chatImages.ts`, `chatVoice.ts`, `reactions.ts`) live in one place. Change a
  limit there, not in a copy.
- `tests/` (`node:test`), `tests/browser/` (Playwright),
  `services/python-orchestrator/`, `native/`, `native_bridge.py`, and
  `docs/architecture/` (read before touching Python).
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
- `PYTHON_ORCHESTRATOR_MODE` (`off` | `shadow`), `_URL` (default
  `http://127.0.0.1:5051`), `_TIMEOUT_MS` (default 500, clamped to 50–5000).
- `CM_DISABLE_NATIVE=1` forces the pure-Python fallback. `DISABLE_HMR=true`
  turns off Vite HMR and file watching.
- `ALLOW_DEMO_LOGIN` in `playwright.config.ts` is a leftover; nothing reads it.

## Authentication and state

External Microsoft/Entra authentication has been removed. Anonymous access is
enabled by default and can be disabled with `ALLOW_ANONYMOUS_ACCESS=false`.
Sessions use the `cm_session` HttpOnly cookie and bearer token compatibility
path. Queue, room, message, media, revision, and socket state remain in the
single Node process until a replacement proves parity.

Sign-in (`POST /api/auth/school-email`, alias `/verify-school`) only checks that
the email is syntactically valid; ownership is never verified. Sessions last
eight hours. Peers see a separate public `sessionId` and generated handle,
never another participant's token or email.

## Runtime behavior

- **Matching** (`join` in `runtime.ts`): interest text is split into lower-cased
  words, minus one-letter words and a stop-word list; `General Peer Discovery`
  is ignored. Score is shared words, plus 100 for an exact interest match.
  Highest score wins, ties go to the earliest queued. With no match, someone
  who set `allowNormal` (or has only the generic interest) pairs with the first
  queued peer who also allows it; otherwise they queue. `verified` is always
  `false`.
- **Liveness:** a queue entry or room member silent for 30 s is dropped by a 5 s
  cleanup timer, and an abandoned room frees its messages and media. Polling or
  a WebSocket `ping` refreshes it. A dropped socket does not end a room. One
  socket per session; a new one closes the old.
- **Messages:** at most 4,000 characters, latest 500 kept per room, and
  evicting one frees its media. Delete turns a message into `Message unsent.`;
  only the sender can delete or edit, and only text can be edited. A repeated
  `clientMessageId` returns the earlier message. Every room mutation bumps
  `room.revision`, which clients send when polling.
- **Media** is sent over `POST /api/chat/send` (7 MB body limit; all other JSON
  is 64 KB), never the socket. Images: up to 4 per message, JPEG/PNG/WebP/GIF,
  1600 px max, a 24 MB budget per room. One voice message per send, up to 3
  minutes. Exact limits are in `src/data/chatImages.ts` and `chatVoice.ts`;
  the server checks magic bytes and rejects non-canonical base64.
- **AI:** `server.ts` owns `/api/ai/*`. Gemini first, Groq only if Gemini is
  absent, static icebreakers if neither. Grounding is enabled only for
  explicitly current or online questions. The chatbot is a labelled simulation
  (`isSimulated` on `ActivePeerInfo`).
- All `/api/*` responses are `no-store`, and unknown paths return a JSON 404.

## Frontend

`App.tsx` drives Access → Matchmaking → Chat and restores the session from
`/api/auth/session`. `MatchmakingQueue.tsx` opens the WebSocket and polls
`/api/match/poll` as a fallback; `ChatRoom.tsx` polls messages about every 1.5 s.
`apiRequest` in `utils/api.ts` adds the bearer token, a 20 s timeout, and throws
the JSON `error` text. The `@` alias points at the project root, not `src/`.
Every `localStorage` access is wrapped in try/catch (storage can be
unavailable), and animations must honor reduced-motion. Viewport height is
tracked through `--app-height` / `--app-top` for mobile keyboards.

## Testing

- `runtime.test.ts` mounts `attachRuntime` on an ephemeral port and drives it
  with real `fetch` and `ws` clients; `issueSession` skips the sign-in route.
- Playwright runs one worker in installed Google Chrome (`channel: 'chrome'`)
  against an isolated server on port 3100 with `GEMINI_API_KEY` cleared. It
  runs the built bundle, so `npm run build` first or use `test:e2e:dev`.
- Run `npm run lint` and `npm test` before calling a change done. `npm run dev`
  fails with `EADDRINUSE` if port 3000 is already taken.

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
