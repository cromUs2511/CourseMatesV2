# Incremental layered-architecture migration

## Decision

`runtime.ts` remains the production source of truth until the replacement has
passed explicit contract, replay, and side-by-side parity checks. The browser
continues to use the existing REST and `/ws/chat` contracts during migration.

## First increment

Introduce a Python orchestration service as an internal, optional dependency.
Node calls it only in `shadow` mode and discards its result. A timeout, bad
response, or unavailable Python service must not change a browser response,
room state, queue state, session, or WebSocket event.

The first Python capability is deterministic local icebreaker fallback. It has
a versioned internal request/response shape, so it can be compared with the
legacy Node fallback without involving authentication or realtime state.

## Boundaries

- TypeScript owns browser presentation and the legacy compatibility edge.
- Python owns future orchestration and AI prompt/provider policy.
- C++ remains a Python-loaded implementation detail for proven hot paths.
- Redis and durable storage are deferred until queue/room ownership migrates;
  adding them before ownership would create competing sources of truth.

## Safety gates

1. `PYTHON_ORCHESTRATOR_MODE=off` is the default.
2. `shadow` is observe-only and requires a configured internal URL.
3. No `enforce` mode exists in this increment.
4. Public API and WebSocket payloads remain unchanged.
5. The Node fallback is used for every user-visible result.
