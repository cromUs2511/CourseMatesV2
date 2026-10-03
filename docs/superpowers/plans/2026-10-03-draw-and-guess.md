# Draw & Guess Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task in this session. The user explicitly instructed execution now.

**Goal:** Add a reliable two-player drawing game with at least 1,000 curated prompts.

**Architecture:** A room-owned authoritative game exposes redacted per-player state over authenticated REST and WebSockets. A React dialog renders normalized strokes with mouse, touch, and pen input, reusing existing game invitations and activity reporting.

**Tech Stack:** TypeScript, React, Express, WebSockets, Canvas, Playwright; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-draw-and-guess-design.md`

## Global Constraints

- Six alternating turns, 60-second drawing deadlines, three choices, 20-second selection deadlines.
- At least 1,000 unique prompts, ten categories, three difficulties.
- Preserve existing chat, authentication, games, and room lifecycle.
- Responsive Android/iOS/Windows browser UI; report emulation and real-device coverage separately.
- Bound stroke batches, canvas capacity, guesses, and network request rates.

## Review Focus

- Secret answers never reach the guesser until reveal.
- Delayed stroke batches cannot restore a cleared canvas or previous turn.
- Backgrounded devices catch up to server deadlines.
- Failed drawing delivery remains visible and does not silently diverge.
- Touch cancellation, keyboard appearance, and orientation changes preserve usability.

## Task 1: Prompt bank and server game

**Files:** `drawGuess.ts`, `drawGuessPrompts.ts`, `src/data/drawGuess.ts`, `tests/drawGuess.test.ts`.

**Interfaces:** `PeerDrawGuess.act(actor, peers, action, now?)`, `snapshot(now?)`, `serializeFor(viewerId, now?)`; shared `DrawGuessState`, `DrawGuessAction`, palette/filter metadata.

- [ ] Write and run failing tests for prompt coverage, redaction, invitations, drawing validation, deadlines, scoring, six turns, and rematches.
- [ ] Implement curated prompt selection and authoritative game state with bounded drawing operations.
- [ ] Run focused tests and confirm all pass.

## Task 2: Runtime transport integration

**Files:** `runtime.ts`, `tests/drawGuessRuntime.test.ts`.

**Interfaces:** authenticated GET/POST `/api/chat/drawing`, per-viewer `drawing_state` events; existing room game lock.

- [ ] Write and run failing real HTTP/WebSocket tests for private delivery, outsiders, clear recovery, and game exclusion.
- [ ] Register the room-owned game and endpoints with bounded action rates.
- [ ] Run runtime tests and existing peer-game tests.

## Task 3: Responsive drawing UI and game catalog

**Files:** `src/components/PeerDrawGuess.tsx`, `src/components/DrawingCanvas.tsx`, `src/drawing.css`, `src/components/ChatRoom.tsx`, `src/components/GamesCatalogDialog.tsx`, `src/data/peerGames.ts`, `tests/browser/drawing.spec.ts`.

**Interfaces:** imperative `PeerDrawGuessHandle.open`, existing `PeerGameActivity`, normalized canvas strokes and serialized client action queue.

- [ ] Add browser tests for mouse/touch drawing, private choices, guesses, clear/undo, resume, and REST recovery; run to confirm missing UI.
- [ ] Implement pointer capture, scaled HiDPI canvas, throttled vector batches, mobile dialog, filters, tools, scores, rematches, and accessible labels.
- [ ] Wire catalog, chat activity, and resume behavior without changing existing games.
- [ ] Run desktop and mobile browser checks, including WebKit when installed.

## Task 4: Review and regression verification

**Files:** `README.md`, this plan, execution record.

- [ ] Review phase transitions, stale requests, memory bounds, and canvas recovery.
- [ ] Run typecheck, lint, format check, full Node tests, coverage, build, existing browser suite, and Python tests where available.
- [ ] Record actual test outcomes and platform limitations; leave changes in the user's working directory for review without publishing.
