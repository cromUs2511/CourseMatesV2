# CourseMates Production Readiness Implementation Plan

**Goal:** Harden the existing anonymous peer-chat application and create repeatable release gates.

**Architecture:** Keep Node authoritative and REST recovery intact. Use cookie-only anonymous sessions, same-origin writes, bounded single-process state, and durable local moderation records on a private volume. Python/native remains optional; no competing session/queue owner is introduced.

**Authorization:** The user requested implementation of the nine-part readiness checklist and explicitly selected execution with “then do it”. Implement in the current shared workspace, preserving unrelated untracked files.

## Decisions and constraints

- Anonymous, self-attested 18+ community; do not claim student verification.
- One Node process/replica; ephemeral chat data intentionally disappears at restart. Production requires explicit single-instance acknowledgement and durable moderation storage.
- Cookie-only sessions; browser JavaScript receives a public session view. Reject bearer and WebSocket payload credentials.
- No chat/media/token/IP contents in logs or reports. Reports record category, anonymous actor identifiers, and timestamps only. Browser-identity bans are limited by anonymous access.
- No public deployment or account changes as part of local implementation.

## Workstreams and verification

- [x] Browser: reproduce failing composer/media tests, preserve reveal-on-focus design with discoverable access, ensure pending media can be sent, test permissions/cleanup; migrate frontend to cookie authentication; add safety controls and policy links.
- [x] Security/runtime: public session serialization and cookie WS handshake; same-origin JSON writes; headers; bounded HTTP/WS limits; request validation; global room/session/media caps; private metrics and readiness; shutdown recovery.
- [x] Safety: bounded persistent report/block/ban store, admin authentication, no message retention; shared existing filter rules with regression tests; report/block endpoints and lifecycle enforcement.
- [x] Operations: strict TypeScript, ESLint/formatter, test coverage gates, portable browser matrix, accessibility/load/failure tests, CI, container hardening, pinned Python environment, native smoke/boundary/sanitizer checks, policy and operations documentation.
- [x] Integration: full type/lint/unit/Python/native/build/browser verification, dependency audit, independent review, correct findings, record external verification gaps without claiming production readiness.

### Verification record (2026-09-26)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | pass — strict `tsc --noEmit`, `noUncheckedIndexedAccess` included |
| `npm run lint` | pass — typecheck plus ESLint over every `*.ts`/`*.tsx` |
| `npm run format:check` | pass — Prettier over the whole repo |
| `npm test` | pass — 51 node tests, including capacity, flood and drain |
| `npm run test:coverage` | pass — above the `.c8rc.json` thresholds |
| `npm run test:python` | pass — 7 shadow-service contract tests |
| `npm run build` | pass |
| `npm run test:e2e` | pass — 53 browser tests, production bundle on port 3100 |
| `npm run test:e2e:dev` | pass — 52 browser tests against the Vite dev server, 1 intentionally skipped |
| `npm audit --audit-level=high` | pass — 0 vulnerabilities |
| `native/tests/smoke.cpp` | pass — plain build |
| `native/tests/test_native.py` | pass — 36 boundary tests |
| `native/tests/bench.py` | pass — numbers recorded in `native/README.md` |
| ASan/UBSan smoke | **not run locally** — no sanitizer runtime in the MinGW toolchain; wired into CI |
| Container build/run | **not run locally** — Docker unavailable on this machine; wired into CI |

The remaining items are recorded as verification gaps in `docs/operations.md`
§9. Nothing here should be read as a claim of production readiness: the
external audit, screen-reader pass and sustained load soak are still missing.

### Re-verification (2026-09-27)

Every local gate in the table above was rerun on the current working tree:
typecheck, lint, format, 52 unit tests, coverage thresholds, 7 Python contract
tests, build, `npm audit` (0 vulnerabilities), 53 production browser tests, 52
dev browser tests plus 1 skipped, `native/tests/smoke.cpp`, 36 native boundary
tests and `native/tests/bench.py` all pass. ASan/UBSan and container builds
remain CI-only gaps.

## Test-first sequence

For behavior changes, add a contract/regression test, observe its expected failure, implement, rerun the focused test, then run the complete relevant suite. Existing failing browser tests are the initial red baseline. Configuration and prose are checked by their consumers.

## Review focus

1. Foreign origins, forged/expired cookies and payload credentials cannot mutate state.
2. Disconnects, stale async responses and duplicate sends do not lose drafts or duplicate messages.
3. Moderation failure, restart and malformed storage fail safely without retaining conversation content.
4. Capacity limits and slow clients cannot grow memory indefinitely.
5. Test servers cannot accidentally use local production AI credentials; release checks report skips as gaps.
