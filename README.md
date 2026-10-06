# CourseMates

Anonymous study matching, built with React, Vite, Express and WebSockets.

## Current experience

- Responsive desktop and mobile layouts with a compact chat header. Long peer
  names remain readable, and the active topic is shown directly below the
  name.
- Light and dark appearance modes with reduced-motion support.
- Fifteen selectable chat color themes, including Crimson, Ocean, Forest,
  Violet, Sunset, Rose, Amber, Slate, Neon Cyan, Electric Blue, Neon
  Magenta, Deep Teal, Cyber Gold, Indigo, and Graphite.
- The selected theme is applied consistently to chat controls, status badges,
  search progress, matchmaking actions, interest controls, music controls,
  and the mobile/desktop chat UI.
- Anonymous peer matching with optional interests, private rooms, rerollable
  handles, and a clearly labelled Student Chatbot Assistant simulation while
  waiting for a match.
- Chat controls for sound, ambient effects, music search/playback, fullscreen,
  photo attachments, replies, reactions, and conversation starters.
- The music-note button beside the microphone opens Send Music Snippet. Choose a
  catalog song or search YouTube, drag a 15–30 second timeline window, preview it,
  and add an optional note. Peers receive the same playback window in a vinyl-style
  chat card with disc playback controls, reactions, reply, copy, and delete actions.
- The normal peer state does not display a redundant `CONNECTED` badge; the
  header only shows meaningful states such as `AI` or `LEFT`.
- Reliable reconnection: a reloaded or backgrounded tab rejoins its live chat
  (revalidated against the server) and shows a **Reconnecting** indicator while
  the connection is down. If the chat has ended, you get a clear ended-chat
  message instead of a broken room.
- Paste images straight from the clipboard into the composer; they go through the
  same validation and send path as picked photos.
- When a peer leaves a game, a single chronological notice appears in the chat
  timeline (no pinned panel).

See [docs/FEATURES.md](docs/FEATURES.md) for a full tour of every feature.

## Draw & Guess

In a real peer chat, open **Games → Draw & Guess**, choose a category and
difficulty, and invite your peer. The game includes **1,100 curated prompts**
across ten categories and three difficulty levels. Each match has six alternating
drawing turns, three private word choices per turn, and 60 seconds to draw.

Draw using a finger, mouse, or pen. Tools include ten colors, three brush sizes,
an eraser, undo, and clear. Correct guesses award both peers 100 points, with a
time bonus of up to 60 points for the guesser. Answers stay private until reveal;
prompts do not repeat within a match. Minimize preserves the game; pending strokes
finish syncing before minimization. Rematches require both players.

Drawing uses bounded vector batches over authenticated HTTP and viewer-specific
WebSocket updates, with REST recovery. Rooms containing a drawing game retain the
current turn and results until its deadline plus a 30-second reconnect grace when
participants become inactive; explicit chat departure still purges the room.

The interface supports responsive desktop and mobile browsers. Run
`npx playwright test --config playwright.drawing.config.ts` for the focused WebKit
(Safari-engine) checks, after `npx playwright install webkit` and a production
build. Browser emulation does not replace checks on physical Android/iOS devices.

## Run locally

Requires Node.js 22.14 or newer.

1. Run `npm ci`.
2. Optionally copy `.env.example` to `.env.local` and configure integrations.
3. Run `npm run dev`, then open http://localhost:3000.

Local development uses the same anonymous entry as production: confirm that you
are 18 or older, accept the community terms, and continue. No email is collected
and no identity is verified. Open two independent browser profiles/private
sessions to test real matching, or use the labelled Student Chatbot Assistant
simulation while waiting.

After signing in, choose an optional interest and select **Find my peers**.
While searching, the progress indicator and chatbot fallback use the selected
chat theme. In a chat, use the palette button to change the theme; the change
is persisted locally and updates both the conversation and its controls.

## Production

Run `npm run build`, then `npm start`. Set `PORT` and `HOST` when needed. The production command serves the built frontend and never launches Vite or Python. The server bundle lives in `dist/.server`, which is excluded from public file serving.

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

`docker compose` wires all of these; see `docs/operations.md` for the runbook.
Reports retain the reported user's IP for up to 30 days. Permanent IP restrictions
remain in force until an administrator lifts them.

CourseMates uses anonymous access. `ALLOW_ANONYMOUS_ACCESS` defaults to true in both local and Render deployments; set it to `false` only when an external access gateway is in place.

## Optional services

### Python shadow orchestrator (Phase 1)

The live Node runtime remains authoritative. The optional Python service is
currently **shadow-only**: it receives a versioned internal icebreaker request,
but its response cannot alter a browser response, authentication, matching,
rooms, chat, or WebSockets.

Start it locally in a second terminal:

```bash
python -m pip install -r services/python-orchestrator/requirements.txt
python -m uvicorn app.main:app --app-dir services/python-orchestrator --host 127.0.0.1 --port 5051
```

Then opt in from `.env.local` with `PYTHON_ORCHESTRATOR_MODE=shadow`. Leave it
at `off` for the default behavior. There is intentionally no enforcement mode;
promotion requires contract, replay, and side-by-side parity evidence.

For the full local deployment topology, run `docker compose up --build`.
It starts the Node web/realtime edge and the Python orchestration service;
the Python image compiles and requires the C++ native module. Node keeps the
public contract while Python/C++ perform shadow orchestration and native text
normalization until the parity gate enables an authoritative path.

- `GEMINI_API_KEY` powers the Student Chatbot Assistant, generated conversation starters, and separate assistant tools. Existing deployments may use `Gemini_AI` as an alias. `GEMINI_MODEL` defaults to `gemini-3.6-flash`; the retired `gemini-2.5-flash` value is automatically upgraded. Chatbot replies use one request, six compact history messages, and short output limits by default. Web grounding is enabled only for explicitly current or online questions.
- `GROQ_API_KEY` is an optional chatbot fallback used only when Gemini is not configured. `GROQ_MODEL` defaults to `groq/compound`.
- YouTube loads only after the user requests music. Its visible player can be closed, and unavailable videos have a direct YouTube link. Playback depends on the video owner's embedding settings and browser restrictions.
- Set `YOUTUBE_API_KEY` to enable song search in the snippet picker. Without it,
  the finite tracks in the built-in catalog remain available. YouTube may begin
  playback near the requested second because seeking uses video keyframes.

Environment values are loaded from `.env.groq.local`, `.env.gemini.local`, `.env.local`, and `.env`; values already present in the process environment take priority. Never commit real credentials.

## Runtime and privacy

`server.ts` serves the app and optional integrations. `runtime.ts` owns one shared session, queue and room store for both HTTP and WebSocket clients. Render supports the live `/ws/chat` endpoint; REST polling remains the recovery path when an upgrade is unavailable.

Sessions are held in memory for up to eight hours, restored through an HttpOnly cookie, and removed on sign-out. Peers receive a separate public identifier, not another participant's token or email. Changing handles is allowed outside a queue or chat.

Messages are held in a bounded RAM buffer (500 messages per room), with a 4,000-character message limit. Chats accept up to four JPEG, PNG, WebP, or GIF photos per message, with optional captions, plus one voice message (up to three minutes) per send. Photos and voice are locked for the first 90 seconds of a room; text and music snippets are not. Source files may be up to 10 MB each; the browser resizes them to at most 1600 pixels and 1 MB per photo and removes source metadata before sending. Photos use authenticated, non-cached image endpoints and a 24 MB per-room memory budget. Deleting a message, evicting it from the buffer, leaving, or signing out also removes its photos. A room stays alive while any participant is active, so one backgrounded peer never ends the chat for the peer who stayed; it is abandoned about 30 seconds after every participant goes quiet. A reload or backgrounded tab rejoins the same room automatically while it is still active (the client keeps a local reconnect snapshot, and an expired session cannot rejoin an old room). Explicit leave and session expiry still end the chat immediately. Restarting the server clears all sessions and rooms.

Photo selection uses the browser's native file picker. Taking a photo requests camera access (no microphone) only after the user selects **Take photo**; permission prompts follow the browser's saved permission state. Camera access requires HTTPS or localhost, and camera tracks stop on capture, dismissal, or disconnection. Login and main-menu grids breathe gently, and theme changes reveal the new appearance from the switch using View Transitions where supported. Both effects honor reduced-motion preferences.

Automatic conversation starters send topic/campus/discipline context, not conversation messages, to Gemini. Messages sent to the Student Chatbot Assistant and up to six recent compact text messages are sent to Gemini. Google Search grounding is enabled only when a message explicitly asks for current or online information. Groq is used only when Gemini is not configured. The separate assistant API sends supplied conversation context only when explicitly called. YouTube has its own data handling.

This in-memory implementation runs as **one server process**. Multiple replicas would need a shared session/matching store and a coordinated expiry policy.

## Verification

Every command below is a release gate. CI runs them on every push and pull
request (`.github/workflows/ci.yml`).

- `npm run typecheck`: strict TypeScript only (`tsc --noEmit`).
- `npm run lint`: typecheck plus ESLint over every `*.ts`/`*.tsx`.
- `npm run format:check` / `npm run format`: Prettier gate and writer.
- `npm test`: runtime regression tests with real HTTP/WebSocket clients.
- `npm run test:coverage`: the same suite under c8 with the line/branch/
  function thresholds in `.c8rc.json`.
- `npm run test:python`: FastAPI shadow-service contract tests.
- `npm run build`: frontend and production server bundles.
- `npm run test:e2e`: the production-mode browser suite; build first. It uses
  an isolated server on port 3100 with `NODE_ENV=test`, so local `.env*` files
  and AI keys are never loaded.
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

Browser tests use an installed Google Chrome by default. Override the browser
with `PW_CHANNEL` — for example `PW_CHANNEL=chromium npx playwright test` after
`npx playwright install chromium`. CI runs the matrix over both channels.

`package-lock.json` is the maintained dependency lockfile. The `qs` override selects the compatible patched parser release used by Express.

References: [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash).
