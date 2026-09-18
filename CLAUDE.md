# CourseMates development guide

CourseMates is an anonymous peer-matching study chat. The supported product
path is React/Vite in `src/`, Express in `server.ts`, and the in-memory runtime
in `runtime.ts`. The live WebSocket endpoint is `/ws/chat`; Render supports the
upgrade and REST polling remains the reconnect fallback.

## Commands

- `npm run dev` — Vite middleware plus the Express runtime on port 3000.
- `npm test` — Node runtime and utility regression suite.
- `npm run lint` — TypeScript checks.
- `npm run build` — Vite client and production Express bundle.
- `npm run test:e2e` — production-mode Playwright suite.
- `python -m pytest -p no:cacheprovider services/python-orchestrator/tests/test_main.py -q` — Python shadow-service contracts.

## Authentication and state

External Microsoft/Entra authentication has been removed. Anonymous access is
enabled by default and can be disabled with `ALLOW_ANONYMOUS_ACCESS=false`.
Sessions use the `cm_session` HttpOnly cookie and bearer token compatibility
path. Queue, room, message, media, revision, and socket state remain in the
single Node process until a replacement proves parity.

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

## Retired code

The former Python REST/realtime prototypes and one-off UI patch scripts were
removed. Do not restore or route product traffic through them.
