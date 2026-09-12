# CourseMates

Anonymous study matching, built with React, Vite, Express and WebSockets.

## Run locally

Requires Node.js 22.14 or newer.

1. Run `npm ci`.
2. Optionally copy `.env.example` to `.env.local` and configure integrations.
3. Run `npm run dev`, then open http://localhost:3000.

Local development enables clearly labelled demo access by default. Enter a valid email or use the Gmail quick-fill button; this does **not** verify email ownership. Open two independent browser profiles/private sessions to test real matching, or choose the simulated partner while waiting.

## Production

Run `npm run build`, then `npm start`. Set `PORT` and `HOST` when needed. The production command serves the built frontend and never launches Vite or Python. The server bundle lives in `dist/.server`, which is excluded from public file serving.

Production disables demo login by default. Configure Microsoft sign-in, or explicitly set `ALLOW_DEMO_LOGIN=true` for a demonstration. Set `ALLOW_DEMO_LOGIN=false` to disable it in any environment.

For Microsoft sign-in, configure `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` and `APP_URL`. Register `${APP_URL}/auth/callback` as a Web redirect URI and allow the `openid profile email` scopes. Sign-in uses authorization code flow with PKCE, a short-lived state cookie, and Microsoft's UserInfo endpoint. The account must return a valid email address. Demo and verified sessions have separate matching pools.

## Optional services

- `GEMINI_API_KEY` powers the Student Chatbot Assistant, generated conversation starters, and separate assistant tools. Existing deployments may use `Gemini_AI` as an alias. `GEMINI_MODEL` defaults to `gemini-3.6-flash`; the retired `gemini-2.5-flash` value is automatically upgraded. Chatbot replies use one request, six compact history messages, and short output limits by default. Web grounding is enabled only for explicitly current or online questions.
- `GROQ_API_KEY` is an optional chatbot fallback used only when Gemini is not configured. `GROQ_MODEL` defaults to `groq/compound`.
- YouTube loads only after the user requests music. Its visible player can be closed, and unavailable videos have a direct YouTube link. Playback depends on the video owner's embedding settings and browser restrictions.

Environment values are loaded from `.env.groq.local`, `.env.gemini.local`, `.env.local`, and `.env`; values already present in the process environment take priority. Never commit real credentials.

## Runtime and privacy

`server.ts` serves the app and optional integrations. `runtime.ts` owns one shared session, queue and room store for both HTTP and WebSocket clients. No Python installation is needed. The older `app.py`, `engine.py`, patch scripts and unused dashboard/group components are historical prototypes, not part of the supported application flow.

Sessions are held in memory for up to eight hours, restored through an HttpOnly cookie, and removed on sign-out. Peers receive a separate public identifier, not another participant's token or email. Changing handles is allowed outside a queue or chat.

Messages are held in a bounded RAM buffer (500 messages per room), with a 4,000-character message limit. Chats accept up to four JPEG, PNG, or WebP photos per message, with optional captions. Source files may be up to 10 MB each; the browser resizes them to at most 1600 pixels and 1 MB per photo and removes source metadata before sending. Photos use authenticated, non-cached image endpoints and a 24 MB per-room memory budget. Deleting a message, evicting it from the buffer, leaving, or signing out also removes its photos. Abandoned rooms expire after roughly 30–35 seconds without polling/heartbeat. Refresh can resume an existing room by starting the matching flow again while that room is still active. Restarting the server clears all sessions and rooms.

Photo selection uses the browser's native file picker. Taking a photo requests camera access (no microphone) only after the user selects **Take photo**; permission prompts follow the browser's saved permission state. Camera access requires HTTPS or localhost, and camera tracks stop on capture, dismissal, or disconnection. Login and main-menu grids breathe gently, and theme changes reveal the new appearance from the switch using View Transitions where supported. Both effects honor reduced-motion preferences.

Automatic conversation starters send topic/campus/discipline context, not conversation messages, to Gemini. Messages sent to the Student Chatbot Assistant and up to six recent compact text messages are sent to Gemini. Google Search grounding is enabled only when a message explicitly asks for current or online information. Groq is used only when Gemini is not configured. The separate assistant API sends supplied conversation context only when explicitly called. YouTube and Microsoft have their own data handling.

This in-memory implementation runs as **one server process**. Multiple replicas would need a shared session/matching store and a coordinated expiry policy.

## Verification

- `npm run lint`: TypeScript checks.
- `npm test`: runtime regression tests with real HTTP/WebSocket clients.
- `npm run build`: frontend and production server bundles.
- `npm run test:e2e`: headless Chrome tests; build first. Uses an isolated server on port 3100 with demo login and local suggestions.
- `npm run test:e2e:dev`: the same browser suite against Vite development mode.
- `npm run clean`: cross-platform cleanup of generated build output.

Browser tests use an installed Google Chrome. To use Playwright's bundled Chromium instead, install it with `npx playwright install chromium` and remove `channel: 'chrome'` from `playwright.config.ts`.

`package-lock.json` is the maintained dependency lockfile. The `qs` override selects the compatible patched parser release used by Express.

References: [Microsoft UserInfo](https://learn.microsoft.com/en-us/entra/identity-platform/userinfo), [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash).
