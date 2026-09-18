# Python Shadow Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reversible internal Python service boundary without changing the live Node runtime's behavior.

**Architecture:** Node keeps ownership of all public routes and invokes an optional Python client only after producing the legacy result. Python exposes a versioned health and icebreaker-fallback contract; its output is telemetry-only in shadow mode.

**Tech Stack:** TypeScript, Express, FastAPI, Pydantic, Node test runner.

**Spec:** `docs/architecture/2026-09-18-layered-migration.md`

## Global Constraints

- `runtime.ts` remains the source of truth.
- Default mode is `off`; shadow failures cannot affect a request.
- Do not alter public REST, WebSocket, session, queue, room, media, or AI fallback contracts.

---

### Task 1: Node internal-client contract

**Files:**
- Create: `pythonOrchestrator.ts`
- Create: `tests/pythonOrchestrator.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Produces `createPythonOrchestratorClient(config, fetchImpl)` with `observeIcebreakers(input)`.
- Consumes a versioned `/internal/v1/icebreakers` Python endpoint.

- [x] Write tests proving `off` makes no request and `shadow` swallows an unavailable service.
- [x] Run `npx tsx --test tests/pythonOrchestrator.test.ts`; verify the missing-module failure.
- [x] Implement the minimal non-throwing client and run the test again.
- [x] Wire the client after the legacy icebreaker response is selected; do not await it.

### Task 2: Python isolated service

**Files:**
- Create: `services/python-orchestrator/app/main.py`
- Create: `services/python-orchestrator/tests/test_main.py`
- Create: `services/python-orchestrator/requirements.txt`

**Interfaces:**
- `GET /internal/v1/health` returns capability/version information.
- `POST /internal/v1/icebreakers` accepts bounded topic, discipline, and campus fields.

- [x] Write FastAPI tests for health and a stable four-item fallback response.
- [x] Run `python -m pytest services/python-orchestrator/tests/test_main.py`; verify the module is absent.
- [x] Implement the endpoint and rerun the tests.

### Task 3: Verification and operations documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [x] Document the disabled-by-default flags and local Python start command.
- [x] Run Node tests, typecheck, Python tests, and production build.
- [x] Confirm the public runtime tests remain unchanged and passing.
