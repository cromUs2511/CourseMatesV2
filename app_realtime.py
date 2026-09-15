"""CourseMates - FastAPI WebSocket server wired to the native core.

    pip install -r requirements.txt
    pip install ./native                 # builds coursemates_native
    python -m uvicorn app_realtime:app --host 0.0.0.0 --port 5050

This is the integration reference for `native_bridge`: it shows where each
native call belongs in a real WebSocket lifecycle. Everything stays in RAM and
no message is ever written to disk or kept after relay -- the native filter
returns offsets and verdicts, never text it has retained.

Relationship to the rest of the repo: `app.py` is the REST-polling prototype.
This module is the WebSocket version and does not import it; run one or the
other. The production frontend currently talks to `server.ts`, so treat this as
the Python-backend path, not a drop-in for that.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import os
import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import native_bridge as nb

# ---------------------------------------------------------------------------
# Native singletons. Build them once at import: the automaton compile is the
# expensive part and it must not happen per connection.
# ---------------------------------------------------------------------------

FILTER = nb.build_filter()

# Per-session message budget: 12-message burst, 4/s sustained. A human typing
# fast peaks around 1/s; a bot flood is 50+.
MSG_LIMITER = nb.build_rate_limiter(capacity=12, refill_per_sec=4)

# Per-IP connection budget. This is the one that stops a botnet before it ever
# reaches the session layer, so it is deliberately tighter and slower to refill.
CONN_LIMITER = nb.build_rate_limiter(
    capacity=8, refill_per_sec=0.2, strikes_to_block=3, base_block_ms=30_000
)

# Requeue budget: stops a client from spamming join/leave to reshuffle partners
# until it gets one it likes -- which is how anonymous platforms get abused.
REQUEUE_LIMITER = nb.build_rate_limiter(capacity=5, refill_per_sec=0.1)

QUEUE = nb.build_match_queue(general_hold_ms=8_000)

ALLOWED_EMAIL_DOMAINS = {
    d.strip().lower()
    for d in os.environ.get("CM_ALLOWED_DOMAINS", "").split(",")
    if d.strip()
}

SESSION_TTL_S = 8 * 3600
QUEUE_MAX_WAIT_MS = 5 * 60 * 1000
ROOM_IDLE_S = 15 * 60
SWEEP_INTERVAL_S = 2.0

ADJECTIVES = ["Curious", "Astute", "Quantum", "Resilient", "Pragmatic", "Keen",
              "Analytical", "Nimble", "Serene", "Luminous", "Vibrant", "Brisk"]
NOUNS = ["Cardinal", "Falcon", "Tamaraw", "Builder", "Coder", "Architect",
         "Engineer", "Scholar", "Voyager", "Navigator", "Polymath", "Innovator"]
AVATARS = ["🦅", "🦉", "🦊", "🐺", "🦁", "🚀", "⚡", "🔬", "📐", "💻", "🎨"]


@dataclass
class Session:
    id: str
    token: str
    hashed_student_id: str
    handle: str
    avatar: str
    verified: bool
    campus: str
    discipline: str
    year: int
    interests: list[str]
    created_at: float = field(default_factory=time.time)
    room_id: str | None = None


@dataclass
class Room:
    id: str
    peers: tuple[str, str]
    topic: str
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)


SESSIONS: dict[str, Session] = {}          # session id -> Session
TOKENS: dict[str, str] = {}                # bearer token -> session id
SOCKETS: dict[str, WebSocket] = {}         # session id -> live socket
ROOMS: dict[str, Room] = {}

app = FastAPI(title="CourseMates realtime core", version="2.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class VerifyRequest(BaseModel):
    email: str
    campus: str = "Main Campus"
    discipline: str = "Computer Science & IT"
    year: int = 0
    interests: list[str] = []


@app.post("/api/auth/verify")
def verify(req: VerifyRequest) -> Any:
    email = req.email.strip().lower()
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        return JSONResponse(status_code=403, content={"error": "Invalid email address."})
    domain = email.rsplit("@", 1)[-1]
    if ALLOWED_EMAIL_DOMAINS and domain not in ALLOWED_EMAIL_DOMAINS:
        return JSONResponse(
            status_code=403,
            content={"error": "Use your institutional email address."},
        )

    sid = secrets.token_urlsafe(16)
    token = secrets.token_urlsafe(32)
    session = Session(
        id=sid,
        token=token,
        # The address itself is never stored. The hash exists only so a banned
        # student cannot trivially re-register, and it is not reversible.
        hashed_student_id=hashlib.sha256(email.encode()).hexdigest(),
        handle=f"{random.choice(ADJECTIVES)} {random.choice(NOUNS)} #{random.randint(1000, 9999)}",
        avatar=random.choice(AVATARS),
        verified=bool(ALLOWED_EMAIL_DOMAINS),
        campus=req.campus,
        discipline=req.discipline,
        year=req.year,
        interests=list(req.interests),
    )
    SESSIONS[sid] = session
    TOKENS[token] = sid
    return {
        "success": True,
        "session": {
            "sessionId": sid,
            "token": token,
            "sessionHandle": session.handle,
            "sessionAvatar": session.avatar,
            "isVerified": session.verified,
            "hashedStudentId": session.hashed_student_id,
        },
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    stats = QUEUE.stats()
    return {
        "status": "ok",
        "ramZeroLogActive": True,
        "engine": nb.status(),
        "queue": {"waiting": stats.waiting, "oldestWaitMs": stats.oldest_wait_ms},
        "rooms": len(ROOMS),
        "sockets": len(SOCKETS),
        "rateLimiterKeys": len(MSG_LIMITER),
        "filterPatterns": FILTER.pattern_count,
    }


# ---------------------------------------------------------------------------
# WebSocket loop
# ---------------------------------------------------------------------------

async def send_json(session_id: str, payload: dict[str, Any]) -> None:
    ws = SOCKETS.get(session_id)
    if ws is None:
        return
    try:
        await ws.send_json(payload)
    except (WebSocketDisconnect, RuntimeError):
        SOCKETS.pop(session_id, None)


async def pair(a_id: str, b_id: str, topic: str) -> None:
    """Create a room for two sessions and tell both sides."""
    a, b = SESSIONS.get(a_id), SESSIONS.get(b_id)
    if a is None or b is None:
        return
    room = Room(id=f"room_{secrets.token_urlsafe(9)}", peers=(a_id, b_id), topic=topic)
    ROOMS[room.id] = room
    a.room_id = b.room_id = room.id

    for me, peer in ((a, b), (b, a)):
        await send_json(me.id, {
            "type": "matched",
            "roomId": room.id,
            "topic": topic,
            "peer": {
                "handle": peer.handle,
                "avatar": peer.avatar,
                "discipline": peer.discipline,
                "campus": peer.campus,
                "year": peer.year,
            },
        })


async def close_room(room_id: str, reason: str, except_id: str | None = None) -> None:
    room = ROOMS.pop(room_id, None)
    if room is None:
        return
    for pid in room.peers:
        s = SESSIONS.get(pid)
        if s is not None and s.room_id == room_id:
            s.room_id = None
        if pid != except_id:
            await send_json(pid, {"type": "peer_left", "roomId": room_id, "reason": reason})


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket, token: str = Query(default="")) -> None:
    client_ip = ws.client.host if ws.client else "unknown"

    # Gate 1 -- connection flood, before anything is allocated for this client.
    gate = CONN_LIMITER.allow(f"conn:{client_ip}")
    if not gate.allowed:
        await ws.close(code=1008, reason="Too many connection attempts")
        return

    sid = TOKENS.get(token)
    session = SESSIONS.get(sid) if sid else None
    if session is None or time.time() - session.created_at > SESSION_TTL_S:
        await ws.close(code=1008, reason="Invalid or expired session")
        return

    await ws.accept()
    SOCKETS[session.id] = ws
    await send_json(session.id, {"type": "ready", "handle": session.handle,
                                 "engine": nb.status()})

    try:
        while True:
            frame = await ws.receive_json()

            # Gate 2 -- per-session frame budget. One call, GIL released, ~1.5us.
            decision = MSG_LIMITER.allow(session.id)
            if not decision.allowed:
                await send_json(session.id, {
                    "type": "rate_limited",
                    "retryAfterMs": decision.retry_after_ms,
                    "blocked": decision.blocked,
                })
                if decision.blocked and decision.strikes >= 8:
                    await ws.close(code=1008, reason="Flood protection")
                    return
                continue

            kind = frame.get("type")
            if kind == "join_queue":
                await handle_join(session, frame)
            elif kind == "send_message":
                await handle_send(session, frame)
            elif kind == "typing":
                await handle_typing(session, frame)
            elif kind == "leave":
                await handle_leave(session)
            elif kind == "ping":
                await send_json(session.id, {"type": "pong", "t": int(time.time() * 1000)})

    except WebSocketDisconnect:
        pass
    finally:
        SOCKETS.pop(session.id, None)
        QUEUE.remove(session.id)
        if session.room_id:
            await close_room(session.room_id, "disconnected", except_id=session.id)


async def handle_join(session: Session, frame: dict[str, Any]) -> None:
    if not REQUEUE_LIMITER.allow(f"requeue:{session.id}").allowed:
        await send_json(session.id, {"type": "error",
                                     "message": "Too many requeues. Give it a moment."})
        return
    if session.room_id:
        await close_room(session.room_id, "requeued", except_id=session.id)

    interests = [str(i) for i in frame.get("interests", session.interests)][:12]
    candidate = nb.make_candidate(
        session.id,
        verified=session.verified,
        campus=session.campus,
        discipline=session.discipline,
        year=int(frame.get("year", session.year) or 0),
        topic=str(frame.get("topic", "General Peer Discovery")),
        interests=interests,
        allow_general=bool(frame.get("allowGeneral", True)),
    )

    # One call does both jobs: pair now if a good partner is waiting, otherwise
    # join the queue. No separate "search then insert" race to worry about.
    result = QUEUE.enqueue(candidate)
    if result.matched:
        await pair(session.id, result.peer_session_id, result.topic)
    else:
        await send_json(session.id, {
            "type": "queued",
            "position": QUEUE.position(session.id),
            "waiting": len(QUEUE),
        })


async def handle_send(session: Session, frame: dict[str, Any]) -> None:
    room = ROOMS.get(session.room_id or "")
    if room is None:
        await send_json(session.id, {"type": "error", "message": "You are not in a room."})
        return

    text = str(frame.get("text", ""))[:4000]
    if not text.strip():
        return

    # Gate 3 -- abuse scan. ~7us for a normal message against 300 patterns.
    verdict = FILTER.scan(text)
    if verdict.action == nb.BLOCK:
        await send_json(session.id, {
            "type": "message_blocked",
            "categories": list(verdict.categories),
            "message": "That message was not sent. It matched our safety rules.",
        })
        return
    if verdict.action == nb.MASK:
        text = FILTER.redact(text)

    room.last_active = time.time()
    peer_id = room.peers[1] if room.peers[0] == session.id else room.peers[0]
    payload = {
        "type": "message",
        "roomId": room.id,
        "id": f"msg_{secrets.token_urlsafe(8)}",
        "senderHandle": session.handle,
        "senderAvatar": session.avatar,
        "text": text,
        "timestamp": int(time.time() * 1000),
        "flagged": list(verdict.categories) if verdict.action == nb.FLAG else [],
    }
    # Relayed to both sides and then dropped. Nothing is appended to a log, a
    # buffer, or a database -- this is the whole zero-log guarantee.
    await send_json(peer_id, payload)
    await send_json(session.id, {**payload, "own": True})


async def handle_typing(session: Session, frame: dict[str, Any]) -> None:
    room = ROOMS.get(session.room_id or "")
    if room is None:
        return
    peer_id = room.peers[1] if room.peers[0] == session.id else room.peers[0]
    await send_json(peer_id, {"type": "peer_typing", "isTyping": bool(frame.get("isTyping"))})


async def handle_leave(session: Session) -> None:
    QUEUE.remove(session.id)
    if session.room_id:
        await close_room(session.room_id, "left", except_id=session.id)
    await send_json(session.id, {"type": "left"})


# ---------------------------------------------------------------------------
# Periodic sweep
#
# Three jobs the native side cannot do on its own because it owns no threads:
#   1. drain()  - batch-match whoever the greedy path could not pair
#   2. expire() - evict dead tabs from the queue
#   3. gc()     - reclaim rate-limiter buckets, which otherwise grow forever
# ---------------------------------------------------------------------------

async def sweep_loop() -> None:
    while True:
        try:
            await asyncio.sleep(SWEEP_INTERVAL_S)

            for p in QUEUE.drain(128):
                await pair(p.a, p.b, p.topic)

            for sid in QUEUE.expire(QUEUE_MAX_WAIT_MS):
                await send_json(sid, {"type": "queue_timeout"})

            MSG_LIMITER.gc(600_000)
            CONN_LIMITER.gc(600_000)
            REQUEUE_LIMITER.gc(600_000)

            now = time.time()
            for room_id, room in list(ROOMS.items()):
                if now - room.last_active > ROOM_IDLE_S:
                    await close_room(room_id, "idle")
            for sid, s in list(SESSIONS.items()):
                if now - s.created_at > SESSION_TTL_S and sid not in SOCKETS:
                    TOKENS.pop(s.token, None)
                    SESSIONS.pop(sid, None)

        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the sweep must never die
            print(f"[sweep] {type(exc).__name__}: {exc}")


@app.on_event("startup")
async def on_startup() -> None:
    app.state.sweep = asyncio.create_task(sweep_loop())
    print(f"[startup] native core: {nb.status()}")
    if not nb.NATIVE_AVAILABLE:
        print("[startup] WARNING: running the pure-Python fallback. "
              "Filtering is orders of magnitude slower; see native/README.md.")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    app.state.sweep.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await app.state.sweep


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5050)
