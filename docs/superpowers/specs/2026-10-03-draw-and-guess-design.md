# Draw & Guess design

## Goal and approved scope

Add Draw & Guess to CourseMates so two matched peers can take turns drawing and guessing. The user approved six alternating rounds, 60-second drawing turns, three secret prompt choices, a large categorized prompt bank, drawing tools, scoring, results, and rematches. The user additionally requires compatibility with Android, iOS, and Windows and protection against regressions in existing features.

This is a browser feature in the existing React application, not a separate native application. Compatibility means a responsive interface and mouse, touch, and pen interaction in current Android Chrome, iOS Safari, and Windows Chrome/Edge. Testing must distinguish browser emulation from testing on actual devices; universal platform compatibility cannot be asserted from emulation alone.

## Integration and boundaries

- Add `drawing` to `PeerGameKey` and to the Games catalog. Connect a `PeerDrawGuess` component to `ChatRoom` using the existing imperative open handle and `usePeerGameActivity` pattern.
- Use existing `GameInvitation`, leave notices, minimize/resume controls, and focus restoration. Minimize preserves the running game and its server deadline. Leaving stops the game for both participants.
- Keep authoritative game logic in a new root-level `drawGuess.ts`. Store its instance on the existing room; it expires and disappears with that room.
- Add authenticated GET/POST `/api/chat/drawing` endpoints using existing room membership checks and the multiplayer feature flag. Send per-viewer `drawing_state` WebSocket events after successful actions, with REST polling as a recovery path.
- Include drawing in `activePeerGame` and check `assertRoomGameFree` for invitations, acceptance, and rematches. Other games, including UNO, cannot overlap an unfinished drawing match or invitation.
- Keep changes to existing files limited to integration points. No additional dependencies, identity changes, persistent chat storage, or changes to existing game rules.

## Prompt bank

Create a server-only bank containing at least 1,000 unique, curated English prompts. Categories: animals, food, objects, nature, places, sports, technology, campus life, actions, and funny scenarios. Each entry has a stable ID, category, difficulty (`easy`, `medium`, `hard`), display phrase, and explicitly allowed answer aliases where useful.

An invitation specifies a category or all categories and a difficulty or mixed difficulty. Every category must have at least 60 entries and every category/difficulty combination at least 12. Use original, drawable concepts; avoid padding with mechanically generated adjective combinations. Favor recognizable nouns on easy, multi-part objects/actions on medium, and drawable scenes on hard.

Choose three distinct prompts randomly without replacement. Once offered, those IDs are excluded for the rest of the match, including unselected choices. Reset the exclusion set for a rematch. Keep bank contents and unchosen prompt IDs out of public state. The client receives labels and counts for filters, not the entire bank.

## Match lifecycle

1. Sender selects filters and invites their peer. Invitation expires after 90 seconds. Only the other participant can accept. Sender can cancel and recipient can decline.
2. Acceptance starts a six-round match with the inviter drawing first. Players alternate for equal three-turn drawing opportunities.
3. Drawer has 20 seconds to choose one of three prompts. After the selection deadline, the server automatically chooses one of those prompts so a disconnected drawer cannot indefinitely block play.
4. Drawing lasts 60 seconds from selection. Only the drawer can send drawing operations; only the guesser can submit guesses. Guesser sees category and a letter-count mask that preserves spaces and punctuation.
5. Correct guess ends the round immediately. Both players receive 100 points for successful cooperation; the guesser receives an additional 0–60 points based on whole seconds remaining. Wrong guesses receive no points. Timeout reveals the answer with no score change.
6. Reveal phase displays the answer, drawing, guesses, and scores. Either participant can advance to the next turn; a stale or duplicate advance must not skip a turn.
7. After round six, show both final scores and the winner or tie. Rematch requires agreement from both peers, resets scores and prompt exclusions, and swaps the initial drawer.

Use server time for all deadlines. Polling and serialization enforce expiry without relying on browser timers; sleeping/backgrounded devices catch up when they reconnect. Every turn-changing action carries match ID and round number. Reject stale requests and invalid phase transitions. Use the state revision for operations where duplicate or stale writes could undo newer drawing.

## Drawing protocol

Use a fixed logical drawing space (800 × 500) with normalized point coordinates. The responsive canvas scales that same space for both players, preserving aspect ratio across portrait phones and desktop windows.

Send vector strokes rather than screenshots. A stroke has an ID, validated color from an allowed palette, brush width, eraser flag, and a bounded array of normalized points. Render erasing consistently with a white canvas background. Stroke append batches let the peer see work while a long stroke is still in progress; stroke boundaries make undo remove one complete stroke.

Provide colors, three brush sizes, brush/eraser selection, undo last stroke, and clear canvas. Clear increments a canvas version, preventing delayed pre-clear batches from restoring erased work. New rounds reset the canvas and its version. Server validates actor, phase, deadline, finite coordinates, point bounds, stroke ownership, batch size, unique IDs, and per-round capacity before mutation.

Limit each batch to 64 points, each stroke to 2,048 points, and each canvas to 12,000 points and 300 strokes. Throttle writes to no more than four requests per second and allow a bounded burst in the endpoint limiter. Serialize client drawing requests so network latency does not reorder clear, undo, and stroke writes. Show network failures and recover from the authoritative state; do not display unsent drawing as successfully delivered. Bound guesses to 80 characters, 60 entries per round, and no more than one accepted submission per second per guesser.

## Secret words and guess handling

Keep selected answer, aliases, and choices private on the server. During selection only the drawer receives choices; during drawing only the drawer receives the selected phrase. During reveal/results both players receive the selected answer, with unchosen choices still omitted. Never broadcast a common unredacted state to both peers.

Normalize guesses and allowed answers using Unicode normalization, lowercase, trimmed/collapsed spaces, and normalized punctuation. Compare exact normalized forms against the phrase and curated aliases; do not use substring matching. Reject blank/oversized guesses. Display guesses as escaped text. The drawer cannot score by guessing their own word. Answer processing and scoring happen atomically on the server, so duplicate requests cannot award points twice.

## Responsive and accessible interface

- Use Pointer Events for mouse, touch, and pen. Capture the active pointer so drawing continues across the canvas boundary; ignore additional pointers and non-primary mouse buttons.
- Apply `touch-action: none` only to the drawing surface. Preserve scrolling and pinch interaction elsewhere. Pointer cancellation, interrupted gestures, role changes, and unmount clean up active stroke state.
- Keep the canvas aspect ratio stable through resize/orientation changes. Render with a device-pixel-ratio backing buffer for sharp strokes without changing shared coordinates.
- Fit the dialog within the visible viewport with internal scrolling, safe-area padding, wrapping toolbars, and controls at least 44 pixels tall. Keep guess input and submit controls usable with the mobile keyboard open.
- Use a native modal dialog with a labelled title, accessible tool labels, visible focus styles, and focus restoration. Escape minimizes rather than abandoning a match. Respect reduced-motion preferences and existing sound settings.
- Give the canvas a descriptive accessible label and provide explicit role, turn, countdown, and result text. Announce results and errors without announcing every drawing point. Freehand drawing inherently requires a pointing device; do not imply full keyboard equivalence for the drawing role.
- Game is available only for a real peer room, following the existing games' behavior.

## Verification and acceptance

### Server and prompt tests

Verify prompt count, unique IDs/normalized phrases, category and difficulty coverage, filtered selection, distinct choices, and no repeated offers within a match. Verify invitations, membership, self-accept rejection, expiration, secret-word redaction, wrong-role rejection, invalid payloads, stale rounds/canvas versions, stroke/guess limits, clear/undo, deadlines, normalized correct guesses, score idempotency, six alternating turns, final results, leave, and mutual rematches.

Add real HTTP/WebSocket tests for membership, per-viewer state delivery, REST recovery, and mutual exclusion with existing peer games/UNO.

### Browser tests

Exercise two independent users through invite, acceptance, choice, live drawing, guesses, reveal, next turn, minimize/resume, leave, and rematch. Repeat with WebSockets unavailable. Check drawing alignment, clear/undo propagation, no answer leakage, no horizontal overflow, no uncaught browser errors, touch gestures, pointer cancellation, and orientation/viewport changes.

Run focused tests in Chromium with desktop and Android-sized touch contexts and in WebKit with an iPhone-sized touch context where browser binaries are available. Real Android/iOS/Windows checks remain a separate acceptance requirement if those devices are unavailable in this workspace; record that limitation precisely.

### Regression gates

Run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:coverage`, `npm run build`, and the existing production browser suite plus new drawing tests. Run `npm run test:python` when its test dependencies are available. Report unavailable checks or existing failures by name; do not claim nothing can break.

Acceptance requires a working two-player game, at least 1,000 validated prompts, mouse/touch input and responsive UI, private answers, authoritative scoring and deadlines, bounded network/memory use, and passing available regression checks.
