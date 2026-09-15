# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CourseMates: anonymous peer-matching chat for college students. React 19 + Vite frontend, one Express server (`server.ts`) that also owns a raw WebSocket endpoint (`/ws/chat`) via `runtime.ts`. Node.js >= 22.14 required. No database — everything is in-memory in a single server process (see Architecture).

## Commands

- `npm run dev` — start the dev server (tsx runs `server.ts`, which mounts Vite in middleware mode). Serves at http://localhost:3000.
- `npm run build` — builds the frontend (`vite build`) and bundles the server (`esbuild server.ts` → `dist/.server/server.cjs`).
- `npm start` — runs the production bundle (`node dist/.server/server.cjs --production`); requires `npm run build` first.
- `npm run lint` — `tsc --noEmit`, the only linter/type-checker configured.
- `npm test` — runs `tests/*.test.ts` with the native Node test runner (`tsx --test`). No test framework config; tests spin up real `http.Server`/WebSocket instances against `runtime.ts` (see `tests/runtime.test.ts`).
  - Run a single test file: `npx tsx --test tests/runtime.test.ts`
  - Filter by test name: `npx tsx --test tests/runtime.test.ts --test-name-pattern "shared interest"`
- `npm run test:e2e` — Playwright browser tests in `tests/browser/`; builds and runs against `dist/.server/server.cjs --production` on port 3100 with demo login forced on. Requires an installed Google Chrome (uses `channel: 'chrome'`); run `npx playwright install chromium` and remove that line from `playwright.config.ts` to use bundled Chromium instead.
- `npm run test:e2e:dev` — same Playwright suite but against `npm run dev` (Vite) instead of the production bundle.
- `npm run clean` — cross-platform removal of generated build output (`scripts/clean.cjs`).

Playwright runs serially (`workers: 1`) and starts its own server with `GEMINI_API_KEY` blanked, so e2e tests always exercise the local AI fallbacks. `test:e2e:dev` works by setting `TEST_DEV=true` (via `scripts/test-dev.cjs`), which swaps the `webServer` command in `playwright.config.ts`.

Python native core (optional, separate from the Node app — see "Python / native core" below):
- `pip install -r requirements.txt` then `pip install ./native` (needs a C++17 compiler + CMake ≥ 3.18; `pip install -e ./native` for an editable build).
- `python -m uvicorn app_realtime:app --host 0.0.0.0 --port 5050` — run the FastAPI WebSocket server.
- `g++ -std=c++17 -O2 -Wall -Wextra -I native/src native/tests/smoke.cpp -o smoke && ./smoke` — C++-only tests, no Python; run first when a build breaks.
- `pip install ./native[test] && pytest native/tests/test_native.py` — pybind11 boundary tests (includes a GIL-release assertion).
- `python native/tests/bench.py` — latency benchmarks.

There is no separate frontend/backend package — one `package.json`, one Express process serves both API and (in production) the built static frontend.

## Architecture

### Single in-memory runtime, one process
`runtime.ts` is the heart of the app: it owns all server-side state as plain `Map`s (`sessions`, `queue`, `rooms`, `matches`, `sockets`) local to the module — no external store. `attachRuntime(app, server)` wires REST routes and the WebSocket server onto an existing Express app/HTTP server and returns a `stop()` cleanup function. This is explicitly a **single-process** design (documented in README): running multiple replicas would require a shared session/matching/room store, which does not exist today. A periodic `setInterval` sweep in `attachRuntime` expires stale sessions, queue entries, and abandoned rooms (~30s of no heartbeat).

### REST + WebSocket dual transport for the same actions
Chat/matching actions (`send_message`, `delete_message`, `edit_message`, `music_update`, join/leave) are implemented once in `runtime.ts` as internal functions (`send`, `removeMessage`, `editMessage`, `updateMusic`, `join`, `leave`) and are invokable via **both** an HTTP POST route (e.g. `/api/chat/send`) and a WebSocket message type (e.g. `{type: 'send_message', ...}`) on `/ws/chat`. The frontend uses WebSocket when connected and falls back to REST polling (`/api/chat/messages?sinceRevision=...`, `/api/match/poll`) when the socket drops — a room's `revision` counter lets clients detect whether anything changed without retransmitting the full message buffer. When adding a new realtime action, wire it into both the REST route table and the `ws.on('message', ...)` switch in `attachRuntime`, or it'll silently only work over one transport. Note that this is already the case today for **reactions** (`/api/chat/react`) and **typing** (`/api/chat/typing`): both are REST-only and have no WebSocket message type, though both push `message_reactions` / `peer_typing` notifications out over the socket.

WebSocket specifics: the socket authenticates by sending `{type: 'join_queue', token}` as its first message (closed with 1008 if that doesn't happen within 5s); `maxPayload` is 16 KB; the upgrade is rejected if `Origin` doesn't match `APP_URL` (or `http(s)://<host>`); a new socket for the same session closes the previous one. Clients send `ping` to keep queue/room entries alive.

Request-body limits are order-dependent in `server.ts`: `/api/chat/send` is registered **before** the global `express.json({ limit: '64kb' })` with its own auth check and a larger `CHAT_SEND_BODY_LIMIT` (7 MB, for base64 photos/voice). Any new route that needs a big body must be mounted the same way, above the global parser. All `/api` responses get `Cache-Control: no-store`, and the `/api` 404 catch-all must stay after every route registration.

Message limits enforced in `runtime.ts`: 4,000 characters per message, 500 messages per room (older ones are evicted along with their media). Photos: up to 4 per message. Voice: up to 180s / 4 MB. `/api/ai/*` rejects string fields over 2,000 chars and non-array conversation context.

### Auth model
Two session types exist side by side, tracked via `session.authProvider`: `'demo'` (email typed into a form, no verification, gated by `ALLOW_DEMO_LOGIN` — defaults on in dev, off in prod) and `'microsoft_entra_id'` (real OAuth2 PKCE flow against Microsoft Entra, requiring `MICROSOFT_CLIENT_ID`/`SECRET`/`TENANT_ID`/`APP_URL`, in `server.ts`). Demo and verified sessions are matched into **separate pools** — `join()` in `runtime.ts` filters candidates by `queuedSession?.isVerified === session.isVerified`. Sessions live 8 hours, are looked up by bearer token (`Authorization: Bearer <token>` or the `cm_session` HttpOnly cookie), and are wiped on server restart — there is no persistence layer. Microsoft OAuth `state`/PKCE verifiers are also held in an in-memory map (10-minute TTL) plus a `cm_oauth_state` cookie, so the login and callback must hit the same process.

Handles: sessions get a random `Adjective Noun #1234` handle. `/api/auth/reroll` shuffles it and `/api/auth/handle` sets a custom name (2–40 chars, marks `customHandle`, which then blocks reroll). Both are refused (409) while the user is queued or in a chat.

### Matching algorithm
`join()` in `runtime.ts` scores queued candidates by shared interest words (tokenized, stop-words removed, case-insensitive) via `sharedInterest()`; an exact interest-string match scores much higher than a partial word overlap. A participant only matches on "General Peer Discovery" (`allowNormal`) if they opted in or have no specific interests. Highest-scoring candidate wins; ties aren't specially broken.

### Media handling (photos/voice)
Chat photos and voice clips are **not stored on disk** — they live in per-room `Map`s (`room.images`, `room.voices`) inside `runtime.ts`, bounded by `MAX_ROOM_IMAGE_BYTES` (a 24 MB/room budget) and served back through authenticated, no-cache endpoints (`/api/chat/images/:roomId/:messageId/:imageId`, `/api/chat/voice/...`). Parsing/validation of incoming base64 payloads lives in `chatImages.ts` (server) and `voiceMessages.ts` (server), separate from the client-side prep in `src/utils/prepareChatImage.ts` (resizes to ≤1600px/1MB client-side before sending) and the shared types in `src/data/chatImages.ts` / `src/data/chatVoice.ts`. Deleting a message, room expiry, or leaving clears the associated media from these maps (`clearMessageMedia`).

### AI integration (`server.ts`)
All AI endpoints (`/api/ai/icebreakers`, `/api/ai/suggestions`, `/api/ai/assist`, `/api/ai/chatbot`) are Gemini-first (`@google/genai`, model from `GEMINI_MODEL`, default `gemini-3.6-flash`) with hardcoded local/topic-keyword fallbacks when `GEMINI_API_KEY` is unset or the call fails — none of these routes should ever hard-fail the UI just because AI is unconfigured. `/api/ai/chatbot` additionally supports Groq (`GROQ_API_KEY`) as a fallback provider when Gemini isn't configured, with its own model-downgrade retry logic on HTTP 413. Web search grounding (Gemini's `googleSearch` tool) is only enabled per-request when the message text matches a "wants current/online info" heuristic regex. If `GEMINI_MODEL` is set to the retired `gemini-2.5-flash` it is silently upgraded to `gemini-3.6-flash`.

### Music
`/api/music/search` proxies YouTube Data API v3 search (requires `YOUTUBE_API_KEY`; returns 503 without it — the server logs a warning at startup but still runs). `/api/music/directory` is a shared in-memory track list seeded from `DEFAULT_MUSIC_DIRECTORY` in `src/data/musicDirectory.ts`; POSTed community tracks are prepended and the list is capped at 100. Per-room playback state (`room.music`, with its own `revision`) is synced between peers via `updateMusic()` in `runtime.ts`. The client-side YouTube IFrame player lives in `src/utils/youtubePlayer.ts` and `TopMusicBar.tsx`, and only loads once the user asks for music.

### Historical/dead code
`app.py`, `engine.py`, and the root-level `fix_*.py` / `patch_*.py` / `refine_ui.py` / `polish_inputs.py` / `remove_doodles.py` scripts are **not part of the supported app** — they're historical prototypes/one-off patch scripts (per README). No Python is needed to run or build CourseMates; don't wire new features through them.

Components under `src/components/` that are **not imported anywhere** (dead UI): `InstitutionalDashboard.tsx`, `StudyGroupsView.tsx`, `AiAssistantDrawer.tsx`, `EphemeralScratchpad.tsx`, `PrivacySecurityModal.tsx`. Recheck against `App.tsx` / `ChatRoom.tsx` imports before relying on this list. The "simulated partner" offered while waiting comes from `SIMULATED_PEERS` in `src/data/mockData.ts`, used by `MatchmakingQueue.tsx`.

### Python / native core (separate, uncommitted work in progress)
Separate from the historical scripts, there is a newer Python backend path that is **not used by the React frontend** (which only talks to `server.ts`):
- `native/` — a C++17 extension (`coursemates_native`, built with pybind11 + scikit-build-core) for content filtering (Aho-Corasick over Unicode-normalized text), sharded token-bucket rate limiting, and priority-bucket matchmaking. It is header-only apart from `src/bindings.cpp`. `native/README.md` covers build, thread-safety, crash-isolation and tuning in depth.
- `native_bridge.py` — the **only** module allowed to import `coursemates_native`. It exposes `NATIVE_AVAILABLE` and falls back to slower, weaker pure-Python implementations when the extension is missing. It also holds the moderation word list (`DEFAULT_PATTERNS`; severity 1=count, 2=mask, 3=drop). `CM_DISABLE_NATIVE=1` forces the fallback.
- `app_realtime.py` — FastAPI WebSocket server (port 5050) wired to `native_bridge`. It is an alternative to `app.py`, not an addition to it. `CM_ALLOWED_DOMAINS` (comma-separated) restricts sign-in email domains.

Compiled extensions (`*.pyd`, `*.so`, `*.dylib`) are gitignored. A locally built `coursemates_native.cp314-win_amd64.pyd` sits at the repo root. On Windows, MinGW builds must statically link the GCC runtime or the import fails with `DLL load failed`. Match queue interests are tokenized, so a generic word shared by every interest makes everyone match; add such words to `is_stop_word()` in `native/src/match_queue.hpp`.

### Frontend structure
`src/App.tsx` is the single top-level state machine (session → matchmaking queue → chat room), passing state down as props rather than through context/a store. `src/utils/api.ts`'s `apiRequest()` is the one shared fetch wrapper (bearer token header, JSON, timeout) used for all REST calls. Chat themes (`ChatThemeMenu.tsx`), dark mode, and sound preference are persisted to `localStorage` directly in `App.tsx`, not through a settings module. `ChatRoom.tsx` reconciles REST/WebSocket message snapshots through `src/utils/chatMessages.ts` (`reconcileMessageSnapshot`). Shared client/server types live in `src/types.ts`, and the server imports from `src/data/*` too, so keep those files free of browser-only APIs.

Styling is Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config`; styles in `src/index.css`). Both Vite and `tsconfig.json` define the `@/` import alias as the **repo root** (not `src/`). Setting `DISABLE_HMR=true` turns off Vite HMR and file watching (a leftover from AI Studio, which `metadata.json` also comes from).

## Environment configuration

Loaded via `dotenv` from `.env.groq.local`, `.env.gemini.local`, `.env.local`, `.env` in that order (see `.env.example`); real process env vars always win over any `.env*` file. Key vars: `GEMINI_API_KEY`/`GEMINI_MODEL`, `GROQ_API_KEY`/`GROQ_MODEL`, `YOUTUBE_API_KEY` (music search), `PORT`/`HOST`/`APP_URL`, `ALLOW_DEMO_LOGIN`, `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`/`MICROSOFT_TENANT_ID` (tenant defaults to `organizations`; Microsoft sign-in is enabled only when both client ID and secret are set). `Gemini_AI` is accepted as a legacy alias for `GEMINI_API_KEY`. Production mode is detected by `NODE_ENV=production` **or** the `--production` CLI flag. Other vars: `DISABLE_HMR` (Vite), and for the Python path only `CM_DISABLE_NATIVE` / `CM_ALLOWED_DOMAINS`. Never commit real credentials.
