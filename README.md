# CourseMates

**Anonymous peer-to-peer study chat.** Confirm you are 18+, get a random handle,
get matched with another student, then chat, share photos, voice notes and music,
and play eight real-time games together. No sign-up, no email, no identity
verification, and nothing is stored once a chat ends.

Built with **React 19 + Vite + Tailwind** on the front end and **Express +
WebSockets** on the back end. All chat state lives in one Node process, with
optional Gemini/Groq AI helpers, an optional Python shadow service and an
optional C++ native module.

## Contents

- [At a glance](#at-a-glance)
- [The user journey](#the-user-journey)
- [Interface tour](#interface-tour)
- [Features](#features)
- [Games](#games)
- [Safety, moderation and privacy](#safety-moderation-and-privacy)
- [Tech stack and architecture](#tech-stack-and-architecture)
- [Project layout](#project-layout)
- [Run locally](#run-locally)
- [Production](#production)
- [Configuration reference](#configuration-reference)
- [Optional services](#optional-services)
- [API overview](#api-overview)
- [Verification](#verification)
- [Documentation map](#documentation-map)
- [Known limits](#known-limits)

## At a glance

| Area          | What you get                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Access        | Anonymous 18+ gate, 8-hour session, rerollable or custom handle                                                       |
| Matching      | Optional interest topics (_Study / Help_, _Casual / Vent_), shared-word scoring, fallback to normal chat              |
| Chat          | Live messages, typing indicator, reply, edit, delete, copy, six emoji reactions, conversation starters                |
| Media         | Up to 4 photos per message (file, camera or paste), voice messages up to 3 min, YouTube music snippets, shared player |
| Games         | UNO, Tic-Tac-Toe, Rock Paper Scissors, Connect Four, Chess, Trivia, Would You Rather, Draw & Guess                    |
| AI (optional) | Gemini (Groq fallback) powers a labelled Student Chatbot simulation, conversation starters and assistant tools        |
| Look and feel | Light/dark mode, 15 chat color themes, ambient aurora, Spider-Verse web background, phone and desktop layouts         |
| Safety        | Report/block, text filter, 90-second photo/voice lock, durable ban store, admin dashboard                             |
| Resilience    | WebSocket with REST fallback, automatic reconnect after reload, rooms survive a backgrounded peer                     |
| Quality gates | Strict TypeScript, ESLint, Prettier, Node runtime tests, Playwright (incl. axe accessibility), Python/C++ tests, CI   |

## The user journey

**Enter → Match → Chat → Play, share or leave.**

1. **Enter.** Tick the 18+ and community-terms box and continue. A session lasts
   eight hours and is held in an HttpOnly cookie.
2. **Match.** Optionally pick a topic, then select **Find my peers**. While you
   wait, a clearly labelled _simulated_ Student Chatbot Assistant can keep you
   company.
3. **Chat.** Talk, react, reply, share media, listen to music together and invite
   your peer to a game.
4. **Leave.** Either person can leave at any time and the room is purged. A
   refreshed or backgrounded tab rejoins automatically while the room is alive.

## Interface tour

CourseMates has three main screens plus a few overlays. Every screen works from a
320 px phone up to a wide desktop.

### 1. Access gateway

The landing screen. It explains the product, links the **Privacy**, **Terms** and
**Community Guidelines** pages, and asks you to confirm you are 18 or older and
accept the terms. There is nothing to type and no account to create. The
background grid breathes gently (disabled for reduced motion).

### 2. Matchmaking

- A prominent **Find my peers** action, with optional interest controls below it.
- **Interest topics:** _Study / Help_ (focus together or get support with a
  question) and _Casual / Vent_ (relaxed chat, or talk freely in a private space).
  Interests are strictly opt-in; leave them off to match with anyone.
- **Handle card:** shows your anonymous handle with a reroll button or a custom
  handle field. Handles can be changed only outside a queue or chat.
- **Search progress:** an animated indicator with an elapsed timer, in your chat
  theme color. If nobody shares your interest you can choose to chat normally.
- **Chatbot fallback:** while waiting you can talk to the labelled Student Chatbot
  Assistant. It is always marked as a simulation.

### 3. Chat room

**App header.** Sound toggle, light/dark toggle, and an **Account and display
settings** menu with your handle (reroll or custom) and **Disconnect and log out**.
On phones these controls collapse into the settings menu.

**Chat header.** Shows your peer's handle (long names stay readable) with the
active topic directly beneath. It only shows meaningful states such as `AI` or
`LEFT`; there is no redundant `CONNECTED` badge. Actions:

| Control                   | What it does                                           |
| ------------------------- | ------------------------------------------------------ |
| Theme palette             | Opens the 15-theme picker; the choice is saved locally |
| Report or block peer      | Opens the safety dialog                                |
| Fullscreen                | Enter or exit fullscreen                               |
| Games                     | Opens the games catalog                                |
| Disconnect and leave chat | Ends the chat for both of you                          |

A **top music bar** shows the shared player (track, queue, position) and the
ambient effects toggle.

**Message timeline.**

- Bubbles with sender handle and time, plus a **Scroll to latest** button when you
  read back through history.
- Replies show a quoted preview that jumps to the original message.
- **Reply**, **More message actions** (copy, edit, delete) and an emoji reaction
  bar on each message.
- Photos open in a full-size viewer. Voice messages and music snippets render as
  inline cards (see below).
- System notices appear in order in the timeline, for example when a peer leaves
  a game, and a **Reconnecting** indicator shows while the connection is down.
- A typing indicator shows when your peer is composing.
- Up to three **conversation starters** appear above the composer, with a shuffle
  button. They expire after 75 seconds and never limit normal messages.

**Composer.**

- Multi-line text up to 4,000 characters, with reply and edit banners.
- Photo attachments (file picker, **Take photo**, or paste from the clipboard)
  with removable previews.
- Voice recorder with a ready-to-send preview.
- **Music note button** to open _Send Music Snippet_.
- A **media unlock timer** countdown while photos and voice are locked.

**Overlays.** Games catalog, game boards (minimizable and resumable), music
snippet picker, photo viewer, safety dialog, logout confirmation and the theme
menu.

### 4. Admin dashboard

Moderators sign in at `/admin` (username and password, short-lived HttpOnly
cookie, no credentials in URLs) to review reports, ban or restrict users and see
live counters.

### Appearance

- **Light and dark** modes. The switch reveals the new theme from the toggle using
  View Transitions where supported.
- **Fifteen chat color themes:** Crimson red, Ocean blue, Forest green, Violet
  dusk, Sunset orange, Rose pink, Amber glow, Slate graphite, Neon cyan, Electric
  blue, Neon magenta, Deep teal, Cyber gold, Indigo night and Graphite neon.
- The theme is applied consistently to chat bubbles and controls, status badges,
  search progress, matchmaking actions, interest controls, music controls and the
  mobile and desktop layouts. The picker keeps every label inside a 320 px
  viewport.
- **Ambient aurora** that follows the music and glow settings. Tracks matching
  Spider-Man or Spider-Verse soundtrack titles switch the room to a web
  background.
- Reduced-motion preferences are honored everywhere, and the viewport height
  tracks the mobile keyboard so the composer is never hidden.

## Features

### Anonymous access

- 18+ and terms acknowledgement; no email and no identity verification (the old
  school-email endpoint returns `410`).
- Random generated handle, rerollable or custom. Peers see only a public session
  id and handle, never your token.
- `ALLOW_ANONYMOUS_ACCESS` defaults to on; turn it off only behind an external
  access gateway.

### Matching and rooms

- Interest text is split into lower-cased words (minus stop words); the score is
  the number of shared words, plus 100 for an exact match. Highest score wins and
  ties go to the earliest queued peer.
- With no match, peers who allow normal chat pair with the first queued peer who
  also allows it.
- Queue entries that go silent for 30 seconds are dropped.
- A room stays alive while **any** participant is active, so one backgrounded
  peer never ends the chat for the peer who stayed. It is abandoned about 30
  seconds after everyone goes quiet. Explicit leave and session expiry end it
  immediately.

### Messaging

- Messages up to 4,000 characters; the latest 500 are kept per room.
- Reply, edit (text only), delete (becomes _Message unsent._) and copy. A repeated
  `clientMessageId` returns the earlier message instead of duplicating it.
- Six reactions: ❤️ Love, 😆 Laugh, 😮 Wow, 😢 Sad, 😡 Angry, 👍 Like.
- Live delivery over `/ws/chat`, with `revision`-based polling as the fallback.

### Reliable reconnection

- The client saves the live chat locally and revalidates it with the server after
  a reload or backgrounded tab, showing a **Reconnecting** indicator while the
  connection is down.
- If the chat has ended or the session expired, you get a clear ended-chat
  message rather than a broken room.
- Keepalive pings continue while the tab is hidden.

### Photos, voice and paste

- Up to **4 photos** per message: JPEG, PNG, WebP or GIF, with optional captions.
  Sources up to 10 MB are resized in the browser (max 1600 px, 1 MB each) and
  stripped of metadata. A 24 MB per-room budget applies.
- **Take photo** requests camera access (no microphone) only when selected and
  stops tracks on capture, dismissal or disconnect. Camera access requires HTTPS
  or localhost.
- **Paste** images from the clipboard into the composer; they use the same
  validation and send path.
- **Voice messages:** one per send, up to 3 minutes, with a recorder and inline
  player.
- Photos and voice are **locked for the first 90 seconds** of a room, with a
  visible countdown. Text and music are not locked.
- Media is validated server-side (magic bytes, canonical base64), served through
  authenticated non-cached endpoints and removed when a message is deleted,
  evicted or the room ends.

### Music

- **Send Music Snippet:** choose a catalog song or search YouTube, drag a 15–30
  second window, preview it and add an optional note. The peer receives a
  vinyl-style card with disc playback controls, reactions, reply, copy and delete.
- **Shared music player:** both people hear the same track, queue (up to 50 songs)
  and position, shown in the top music bar.
- YouTube loads only after a user asks for music. Playback depends on the video
  owner's embedding settings; unavailable videos show a direct YouTube link.
  Without `YOUTUBE_API_KEY` the built-in catalog still works.

### AI helpers (optional)

| Helper                | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| Student Chatbot       | A labelled simulated partner while you wait for a match   |
| Conversation starters | Topic-aware icebreakers, with built-in fallbacks          |
| Assistant tools       | Explain a concept or summarize the chat, only when called |

Gemini is used first, Groq only if Gemini is not configured, and static
icebreakers if neither is. Web grounding is used only for explicit current or
online questions. Starters send topic, campus and discipline context, never
conversation messages.

## Games

Open **Games** in the chat header to invite your peer. Only one peer game (or an
in-room UNO table) can be live per chat. Every game supports invite, accept or
decline, minimize and resume, leaving (a single notice is posted to the chat
timeline) and rematches. The server holds all state and never sends hidden
information (UNO hands, the Draw & Guess word, unrevealed Would You Rather
choices) to the other player.

| Game                | In short                                                         |
| ------------------- | ---------------------------------------------------------------- |
| UNO                 | Full card game with a lobby arena, challenges and in-room tables |
| Tic-Tac-Toe         | Classic 3×3 with winning-line highlight and rematch              |
| Rock Paper Scissors | Best-of-three; locked-in choices are revealed together           |
| Connect Four        | Drop discs, link four, last-move highlight                       |
| Chess               | Full rules via chess.js, including check and promotion           |
| Trivia              | Question rounds with scores across seven categories              |
| Would You Rather    | Both pick in secret, then answers reveal                         |
| Draw & Guess        | Six turns, 60 s each, 1,100 prompts, mouse/touch/pen drawing     |

### Draw & Guess

Choose a category and difficulty and invite your peer. The game includes **1,100
curated prompts** across ten categories and three difficulty levels. Each match
has six alternating drawing turns, three private word choices per turn
(auto-picked after 20 seconds) and 60 seconds to draw.

Draw with a finger, mouse or pen. Tools: ten colors, three brush sizes, an eraser,
undo and clear. Correct guesses award both peers 100 points, plus a time bonus of
up to 60 points for the guesser. Answers stay private until reveal and prompts do
not repeat within a match. Minimize preserves the game, and rematches require both
players.

Strokes travel as bounded vector batches over authenticated HTTP with
viewer-specific WebSocket updates and REST recovery. A game in progress survives
until its deadline plus a 30-second reconnect grace even if both phones sleep; an
explicit leave still purges the room.

The interface supports responsive desktop and mobile browsers. Run
`npx playwright test --config playwright.drawing.config.ts` for the focused WebKit
(Safari engine) checks after `npx playwright install webkit` and a production
build. Browser emulation does not replace checks on physical Android/iOS devices.

## Safety, moderation and privacy

- **Report or block** a peer from the chat header. Browser identities are
  HMAC-hashed into a 64-hex actor; no message text, email or token is stored.
  Reports keep the reported user's IP for up to 30 days. Permanent IP restrictions
  stay until an administrator lifts them.
- **Text filter** (`moderation-patterns.json`) blocks outgoing messages that break
  community rules, including music titles and notes.
- **Durable data is only moderation records**, written atomically to
  `DATA_DIR/moderation.json`.
- **Ephemeral by design:** sessions, queue, rooms, messages and media are RAM-only,
  are never logged, and disappear when a room ends or the server restarts.
  Sessions last up to eight hours and are removed on sign-out.
- **Rate limiting, origin checks and a fail-closed production config gate**
  protect the service; `/api/*` responses are never cached.
- **Admin dashboard** at `/admin` for moderators, with constant-time secret
  comparison.
- **18+ only**, with public Privacy, Terms and Community pages.
- **Accessibility:** reduced-motion support, keyboard and focus handling, and
  automated axe-core checks.

Messages sent to the Student Chatbot Assistant and up to six recent compact text
messages go to Gemini. Groq is used only when Gemini is not configured. The
separate assistant API sends conversation context only when explicitly called.
YouTube has its own data handling.

## Tech stack and architecture

| Layer             | Technology                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Front end         | React 19, Vite 6, Tailwind CSS 4, Motion, lucide-react, canvas-confetti                  |
| Back end          | Node.js 22+, Express 4, `ws` WebSockets, strict TypeScript                               |
| Games             | chess.js plus one server module per game                                                 |
| AI and music      | `@google/genai` (Gemini), Groq fallback, YouTube Data API for search                     |
| Optional services | Python FastAPI shadow orchestrator, C++17 pybind11 native module                         |
| Tooling           | ESLint, Prettier, `node:test`, c8 coverage, Playwright, axe-core, Docker, GitHub Actions |

`server.ts` serves the app and the optional integrations (AI, music, static
files). `runtime.ts` owns one shared session, queue and room store for both HTTP
and WebSocket clients, and mounts every game module. Render supports the live
`/ws/chat` endpoint; REST polling remains the recovery path when an upgrade is
unavailable.

The runtime is a **single process by design**. Multiple replicas would need a
shared session/matching store and a coordinated expiry policy. A restart clears
all sessions and rooms.

## Project layout

```text
server.ts, runtime.ts            Express bootstrap, AI and music routes; sessions, queue, rooms, WebSocket
safety.ts, serverSecurity.ts     Moderation store and text filter; rate limiter, metrics, production gate
chatImages.ts, voiceMessages.ts  Server-side media validation
ticTacToe.ts rps.ts connectFour.ts chess.ts trivia.ts wouldYouRather.ts uno.ts drawGuess.ts
src/App.tsx                      Access → Matchmaking → Chat flow and session restore
src/components/                  ChatRoom, MatchmakingQueue, AccessGateway, Header, Peer* games,
                                 Uno*, DrawingCanvas, music and media components, AdminDashboard
src/data/                        Limits and types shared by browser and server
src/utils/                       API client, reconnect, clipboard images, sound, theme transition
public/                          Privacy, Terms and Community pages, fonts
tests/                           Node runtime tests; tests/browser/ holds Playwright specs
services/python-orchestrator/    FastAPI shadow service
native/, native_bridge.py        C++ module and its Python bridge
docs/                            Feature guide, operations runbook, architecture, specs and plans
```

## Run locally

Requires Node.js 22.14 or newer.

1. Run `npm ci`.
2. Optionally copy `.env.example` to `.env.local` and configure integrations.
3. Run `npm run dev`, then open http://localhost:3000.

Local development uses the same anonymous entry as production: confirm that you
are 18 or older, accept the community terms and continue. Open two independent
browser profiles or private sessions to test real matching, or use the labelled
Student Chatbot Assistant simulation while waiting.

After signing in, choose an optional interest and select **Find my peers**. In a
chat, use the palette button to change the theme; it is persisted locally and
updates the conversation and its controls.

## Production

Run `npm run build`, then `npm start`. Set `PORT` and `HOST` when needed. The
production command serves the built frontend and never launches Vite or Python.
The server bundle lives in `dist/.server`, which is excluded from public file
serving.

`NODE_ENV=production` (or the `--production` flag) turns on a fail-closed
configuration check. The process exits at startup unless all of these are set:

| Variable            | Requirement                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`           | Public `https://` origin with no path, query or credentials. It also decides the WebSocket origin check and whether the session cookie is `Secure`.   |
| `SINGLE_INSTANCE`   | Must be `true`, with `WEB_CONCURRENCY` unset or `1` and `NODE_APP_INSTANCE` unset or `0`. Chat state is RAM-only and is not shared between processes. |
| `DATA_DIR`          | A persistent private volume. It holds `moderation.json`, the durable report/block/ban store.                                                          |
| `MODERATION_SECRET` | At least 32 random characters. Stable across restarts, otherwise browser-identity bans are lost.                                                      |
| `ADMIN_USERNAME`    | Admin sign-in username for `/admin`.                                                                                                                  |
| `ADMIN_PASSWORD`    | At least 32 random characters; configure it in Render environment variables, never in source code or a URL.                                           |
| `TRUST_PROXY_HOPS`  | Set to `1` behind Render's single trusted proxy so moderation records use the connecting user's IP.                                                   |

`docker compose` wires all of these; see [docs/operations.md](docs/operations.md)
for the runbook.

## Configuration reference

Environment values load from `.env.groq.local`, `.env.gemini.local`, `.env.local`
and `.env`; values already present in the process environment take priority.
Never commit real credentials. See `.env.example` for the full list.

| Variable                             | Purpose                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` (alias `Gemini_AI`) | Powers the chatbot, conversation starters and assistant tools                                                 |
| `GEMINI_MODEL`                       | Defaults to `gemini-3.6-flash`; the retired `gemini-2.5-flash` is upgraded automatically                      |
| `GROQ_API_KEY` / `GROQ_MODEL`        | Chatbot fallback used only when Gemini is absent (model defaults to `groq/compound`)                          |
| `YOUTUBE_API_KEY`                    | Enables song search in the snippet picker; without it `/api/music/search` returns 503 and the catalog remains |
| `PORT` / `HOST`                      | Listen address (defaults `3000` / `0.0.0.0`)                                                                  |
| `ALLOW_ANONYMOUS_ACCESS`             | On unless exactly `false`                                                                                     |
| `CHAT_MULTIPLAYER_V2`                | On unless exactly `false`; off disables peer-game routes (503) and reduces music to play/pause                |
| `SUPPORT_EMAIL`                      | Surfaced to the client by `/api/public-config`                                                                |
| `PYTHON_ORCHESTRATOR_MODE`           | `off` (default) or `shadow`; there is intentionally no enforcement mode                                       |
| `CM_DISABLE_NATIVE`, `DISABLE_HMR`   | Force the pure-Python fallback; turn off Vite HMR and file watching                                           |

Chatbot replies use one request, six compact history messages and short output
limits by default.

## Optional services

### Python shadow orchestrator (Phase 1)

The live Node runtime remains authoritative. The optional Python service is
**shadow-only**: it receives a versioned internal icebreaker request, but its
response cannot alter a browser response, authentication, matching, rooms, chat or
WebSockets.

```bash
python -m pip install -r services/python-orchestrator/requirements.txt
python -m uvicorn app.main:app --app-dir services/python-orchestrator --host 127.0.0.1 --port 5051
```

Then opt in from `.env.local` with `PYTHON_ORCHESTRATOR_MODE=shadow`. Leave it at
`off` for the default behavior. Promotion to an authoritative path requires
contract, replay and side-by-side parity evidence.

### Docker

`docker compose up --build` starts the Node web/realtime edge and the Python
orchestration service. The Python image compiles and requires the C++ native
module. Node keeps the public contract while Python/C++ perform shadow
orchestration and native text normalization.

### C++ native module

A C++17 pybind11 module (content filter, match queue, rate limiter, text
normalization) used only through `native_bridge.py`. See
[native/README.md](native/README.md).

## API overview

All `/api/*` responses are `no-store`, and unknown paths return a JSON 404.

| Area     | Routes                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Auth     | `/api/auth/{anonymous,session,handle,reroll,logout,config}`, `GET /api/public-config`                                    |
| Matching | `/api/match/{join,poll,status,cancel}`                                                                                   |
| Chat     | `/api/chat/{send,messages,edit,delete,react,typing,music,music/next,leave}`, media at `/api/chat/images/*` and `voice/*` |
| Games    | `/api/chat/{tictactoe,rps,connectfour,chess,trivia,wyr,drawing}` and `/api/uno/*`                                        |
| Music    | `GET /api/music/search`, `/api/music/directory`                                                                          |
| AI       | `/api/ai/{icebreakers,suggestions,assist,chatbot}`                                                                       |
| Safety   | `POST /api/safety/<action>` (report, block)                                                                              |
| Admin    | `/api/admin/{login,logout,session,metrics,reports,moderate}`                                                             |
| Health   | `GET /api/health`, `/api/health/live`, `/api/health/ready`                                                               |
| Realtime | `/ws/chat` WebSocket, with REST polling as the recovery path                                                             |

## Verification

Every command below is a release gate. CI runs them on every push and pull
request (`.github/workflows/ci.yml`).

- `npm run typecheck`: strict TypeScript only (`tsc --noEmit`).
- `npm run lint`: typecheck plus ESLint over every `*.ts`/`*.tsx`.
- `npm run format:check` / `npm run format`: Prettier gate and writer.
- `npm test`: runtime regression tests with real HTTP/WebSocket clients.
- `npm run test:coverage`: the same suite under c8 with the thresholds in
  `.c8rc.json`.
- `npm run test:python`: FastAPI shadow-service contract tests.
- `npm run build`: frontend and production server bundles.
- `npm run test:e2e`: the production-mode browser suite; build first. It uses an
  isolated server on port 3100 with `NODE_ENV=test`, so local `.env*` files and AI
  keys are never loaded.
- `npm run test:e2e:dev`: the same browser suite against Vite development mode.
- `npm run clean`: cross-platform cleanup of generated build output.

Native module checks (optional, C++17 + CMake 3.18+):

```bash
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -I native/src native/tests/smoke.cpp -o smoke
./smoke
pip install ./native
python -m pytest -p no:cacheprovider native/tests/test_native.py -q
python native/tests/bench.py
```

Import through `native_bridge.py`, never `coursemates_native` directly.

Browser tests use an installed Google Chrome by default. Override the browser with
`PW_CHANNEL`, for example `PW_CHANNEL=chromium npx playwright test` after
`npx playwright install chromium`. CI runs the matrix over both channels.

`package-lock.json` is the maintained dependency lockfile. The `qs` override
selects the compatible patched parser release used by Express.

## Documentation map

| Document                                                                              | Contents                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [docs/FEATURES.md](docs/FEATURES.md)                                                  | User-facing tour of every feature                      |
| [docs/operations.md](docs/operations.md)                                              | Configuration gate, observability, recovery runbook    |
| [docs/architecture/](docs/architecture/2026-09-18-layered-migration.md)               | Layered migration design (read before touching Python) |
| [docs/superpowers/specs/](docs/superpowers/specs/2026-10-03-draw-and-guess-design.md) | Draw & Guess design                                    |
| [docs/superpowers/plans/](docs/superpowers/plans/)                                    | Dated implementation and verification plans            |
| [CLAUDE.md](CLAUDE.md)                                                                | Developer guide: layout, behavior, conventions         |
| [native/README.md](native/README.md)                                                  | C++ module build and test notes                        |

## Known limits

- One server process only; a restart clears every chat.
- Browser emulation in Playwright is not real-device testing: Android, iOS and
  physical-keyboard behavior still need manual checks.
- YouTube playback depends on each video's embedding settings and may start near
  (not exactly at) the requested second because seeking uses keyframes.
- The Python orchestrator and C++ module are shadow/optional and do not change
  user-visible behavior.

References: [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash).
