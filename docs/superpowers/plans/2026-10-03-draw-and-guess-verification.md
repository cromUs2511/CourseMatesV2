# Draw & Guess execution and verification

## Delivered

- 1,100 original prompts: ten categories with 40 easy, 40 medium, and 30 hard ideas each; curated answer synonyms.
- Six alternating drawing turns, private choices, server deadlines, guesses, cooperative scoring with time bonuses, results, and mutual rematches.
- Mouse, touch, and pen canvas with normalized coordinates, HiDPI rendering, colors, sizes, eraser, undo, clear, and bounded ordered stroke batches.
- Existing invitations, activity indicator, game catalog, leave, minimize/resume, and REST recovery integration.

## Review and rulings

- User approved the design and explicitly instructed immediate execution in the current workspace. Changes remain local; no publishing or remote push was performed.
- Preserve current authentication, anonymous room ownership, and existing game rules. Include all existing peer-game rematches in the shared room lock; a real HTTP regression demonstrated the old overlap before the fix.
- Retain a drawing turn and its final results through its server deadline plus 30 seconds when a device is suspended. Abandoned rooms still expire; explicit departure still purges rooms immediately. Real HTTP regressions demonstrated premature expiry during round one and final results before the fixes.
- Prevent minimize/Escape while a stroke is draining. A browser regression holds the first batch of a 101-point touch stroke and verifies that all points arrive before minimize becomes available.
- WebKit exposed an existing matchmaking race: an initial REST poll could overtake `join_queue`. Polling now waits for the server's `queued` acknowledgement.
- The baseline runtime suite exposed uncaught `ECONNRESET` on rejected WebSocket upgrades. Handle errors locally on rejected raw sockets; the formerly failing runtime suite passes.
- Screenshots exposed score wrapping on narrow screens. Numeric scores remain on one line; long peer names truncate with a full-name title.
- Independent code review found the rematch, background expiry, and pending-upload issues above; all were reproduced, fixed, tested, and reviewed again with no remaining important findings.

## Verified commands

- `node --import tsx --test --test-concurrency=1 tests/*.test.ts`: **123 passed**, no failures on the current shared workspace, including concurrent game-completion changes. The earlier feature-only run passed 112 tests.
- `node node_modules/c8/bin/c8.js node --import tsx --test --test-concurrency=1 tests/*.test.ts`: **112 passed**, coverage thresholds passed. Total line coverage 83.2%, branches 80.86%, functions 94%.
- `npm run lint`: passed, including strict TypeScript checking.
- `npm run build`: passed. Vite reports the existing large-chunk warning.
- `npm run test:python`: **7 passed**, one existing dependency deprecation warning.
- `npx playwright test --config playwright.drawing.config.ts`: **2 passed** using WebKit, exercising desktop and 390 × 844 touch contexts, both live WebSockets and REST recovery, rotated viewport, and delayed stroke uploads.
- Final current-build Chrome check, `npx playwright test tests/browser/drawing.spec.ts --grep WebSocket`: **1 passed** (9.2 seconds), including desktop and touch peers.
- Prettier check of all changed feature, integration, test, and documentation files: passed.
- `git diff --check`: passed.
- Full production Chrome browser regression suite: stopped at the user's request to finish quickly after reaching test 57 of 73. Both new drawing tests passed. Legacy failures included music preferences, REST Tic Tac Toe recovery, header selectors/styles, mobile layouts, backreading, and music queues. Three representative failures (music preferences, REST Tic Tac Toe recovery, and header sizing) were reproduced on pre-feature revision `c518967`; the remaining failures were not individually baseline-verified. The entire browser suite is not green.

## Existing repository limitations

The repository-wide `npm run format:check` reports 18 pre-existing files outside this feature: `CLAUDE.md`, `index.html`, `safety.ts`, `src/components/GameLogos.tsx`, `src/components/Header.tsx`, `src/components/TopMusicBar.tsx`, `src/components/UnoArena.tsx`, `src/components/UnoTable.tsx`, `src/components/YouTubeSnippetPlayer.tsx`, `src/uno.css`, `src/utils/youtubePlayer.ts`, `tests/browser/accessibility.spec.ts`, `tests/browser/app.spec.ts`, `tests/browser/header-menu.spec.ts`, `tests/browser/matching-chat-layout.spec.ts`, `tests/peerGames.test.ts`, `tests/uno.test.ts`, and `uno.ts`. These were not reformatted as part of this feature.

Simultaneous WebKit and parallel Node suites produced local HTTP delays/resets on this Windows test environment. Serial Node execution and isolated WebKit checks completed successfully; no test was disabled to obtain those results.

Browser checks exercise installed Windows Chrome and Playwright WebKit with mobile-sized touch emulation. They do not constitute tests on physical Android/iOS devices, every OS/browser version, or virtual keyboards on physical phones. Freehand drawing requires a pointing device.
