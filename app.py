"""
CourseMates - Standalone FastAPI Python Backend
Run with:
    pip install -r requirements.txt
    python3 -m uvicorn app:app --host 0.0.0.0 --port 5050 --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import time
import random
import hashlib

app = FastAPI(
    title="CourseMates - Python Core Engine",
    description="Ephemeral zero-log study matchmaking and verified anonymous peer network",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADJECTIVES = [
    "Curious", "Astute", "Quantum", "Resilient", "Pragmatic", "Keen", "Ingenious",
    "Analytical", "Dynamic", "Nimble", "Serene", "Luminous", "Vibrant", "Brisk"
]
NOUNS = [
    "Cardinal", "Falcon", "Tamaraw", "Builder", "Coder", "Architect", "Hawk",
    "Engineer", "Scholar", "Voyager", "Navigator", "Polymath", "Innovator"
]
AVATARS = ["🦅", "🦉", "🦊", "🐺", "🦁", "🚀", "⚡", "🔬", "📐", "💻", "🎨"]

class VerifyRequest(BaseModel):
    email: str
    campus: Optional[str] = "Main Campus"
    discipline: Optional[str] = "Computer Science & IT"
    interests: Optional[List[str]] = ["Coding, DSA & Software"]

class JoinQueueRequest(BaseModel):
    sessionId: str
    handle: str
    avatar: Optional[str] = "⚡"
    campus: Optional[str] = "Main Campus"
    discipline: Optional[str] = "Computer Science & IT"
    interests: Optional[List[str]] = []
    topic: Optional[str] = "General Peer Discovery"

class ChatSendRequest(BaseModel):
    roomId: str
    text: str = ""
    senderHandle: str = "Anonymous"
    senderAvatar: Optional[str] = ""
    msgType: str = "text"

class ChatTypingRequest(BaseModel):
    roomId: str
    handle: Optional[str] = ""
    isTyping: bool = False

class ChatLeaveRequest(BaseModel):
    roomId: Optional[str] = ""
    sessionId: Optional[str] = ""

class ChatEditRequest(BaseModel):
    roomId: str
    messageId: str
    text: str = ""

DEFAULT_TOPIC = "General Peer Discovery"

FIFO_QUEUE = []
ROOMS = {}
MATCHES = {}

def _matched_payload(session_id: str) -> dict:
    """Matched response shape shared by /api/match/join and /api/match/poll."""
    matched = MATCHES.get(session_id)
    if not matched:
        return {"status": "idle"}
    return {
        "status": "matched",
        "roomId": matched["roomId"],
        "peer": matched["peer"],
        "topic": matched["topic"],
    }

def _queued_position(session_id: str) -> Optional[int]:
    for idx, item in enumerate(FIFO_QUEUE):
        if item["id"] == session_id:
            return idx + 1
    return None

def _purge_room(room: dict):
    """Drop a room and both peers' bindings so either student can rematch."""
    for peer in (room.get("peerA"), room.get("peerB")):
        if peer and peer.get("id"):
            MATCHES.pop(peer["id"], None)

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "engine": "FastAPI Python 3.10 Engine",
        "python": True,
        "ramZeroLogActive": True,
        "timestamp": int(time.time() * 1000)
    }

@app.post("/api/auth/microsoft/verify-test")
def verify_identity(req: VerifyRequest):
    email = req.email.strip().lower()
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        return JSONResponse(
            status_code=403,
            content={"error": "ACCESS DENIED: Please provide a valid email address."}
        )
    handle = f"{random.choice(ADJECTIVES)} {random.choice(NOUNS)} #{random.randint(1000, 9999)}"
    avatar = random.choice(AVATARS)
    token = f"cm_py_{int(time.time()*1000)}_{random.randint(1000, 9999)}"
    hashed_id = hashlib.sha256(email.encode("utf-8")).hexdigest()
    return {
        "success": True,
        "session": {
            "email": email,
            "isVerified": True,
            "isSchoolVerified": True,
            "hashedStudentId": hashed_id,
            "campus": req.campus,
            "discipline": req.discipline,
            "interests": req.interests,
            "sessionHandle": handle,
            "sessionAvatar": avatar,
            "token": token,
            "authProvider": "microsoft_entra_id_python",
            "createdAt": int(time.time() * 1000)
        },
        "message": "Email identity verified via Python Engine."
    }

@app.post("/api/match/join")
def join_matchmaking(req: JoinQueueRequest):
    sid = req.sessionId
    if not sid or not req.handle:
        return JSONResponse(status_code=400, content={"error": "Session ID and handle required"})

    # Already matched: hand back the same room (idempotent re-join).
    if sid in MATCHES:
        return _matched_payload(sid)

    # If this student is already waiting, keep them queued instead of matching them
    # against a peer while they are still in the queue. This avoids duplicate or
    # self-serving pairings during repeated join requests.
    if _queued_position(sid) is not None:
        return {"status": "queued", "position": _queued_position(sid) or len(FIFO_QUEUE)}

    # FIFO: pair with the first other student already waiting in the queue.
    other_idx = next((idx for idx, item in enumerate(FIFO_QUEUE) if item["id"] != sid), -1)
    if other_idx != -1:
        other = FIFO_QUEUE.pop(other_idx)
        room_id = f"room_py_{int(time.time() * 1000)}_{random.randint(100, 999)}"
        peer_a = {
            "id": sid,
            "handle": req.handle,
            "avatar": req.avatar or "",
            "discipline": req.discipline,
            "campus": req.campus,
            "interests": req.interests or [],
        }
        peer_b = {
            "id": other["id"],
            "handle": other["handle"],
            "avatar": other.get("avatar", ""),
            "discipline": other.get("discipline"),
            "campus": other.get("campus"),
            "interests": other.get("interests") or [],
        }
        topic = req.topic if req.topic != DEFAULT_TOPIC else (other.get("topic") or DEFAULT_TOPIC)
        ROOMS[room_id] = {
            "roomId": room_id,
            "peerA": peer_a,
            "peerB": peer_b,
            "topic": topic,
            "messages": [{
                "id": f"sys_{int(time.time() * 1000)}",
                "senderHandle": "CourseMates System",
                "senderAvatar": "⚡",
                "text": f"Connected! You are chatting anonymously with {peer_b['handle']} ({peer_b['discipline']}, {peer_b['campus']} Campus). Ephemeral Zero-Log memory active on the FastAPI Python Engine.",
                "timestamp": int(time.time() * 1000),
                "type": "system",
            }],
            "typingState": {},
            "peerDisconnected": False,
            "createdAt": int(time.time() * 1000),
        }
        MATCHES[sid] = {"roomId": room_id, "peer": peer_b, "topic": topic}
        MATCHES[other["id"]] = {"roomId": room_id, "peer": peer_a, "topic": topic}
        return _matched_payload(sid)

    # Otherwise queue (idempotent: repeated joins keep a single entry).
    if _queued_position(sid) is None:
        FIFO_QUEUE.append({
            "id": sid,
            "handle": req.handle,
            "avatar": req.avatar or "",
            "campus": req.campus,
            "discipline": req.discipline,
            "interests": req.interests or [],
            "topic": req.topic or DEFAULT_TOPIC,
            "joinedAt": int(time.time() * 1000),
        })
    return {"status": "queued", "position": _queued_position(sid) or len(FIFO_QUEUE)}

@app.get("/api/match/poll")
def poll_matchmaking(sessionId: str = ""):
    if not sessionId:
        return JSONResponse(status_code=400, content={"error": "sessionId query required"})
    if sessionId in MATCHES:
        return _matched_payload(sessionId)
    position = _queued_position(sessionId)
    if position is not None:
        return {"status": "queued", "position": position}
    return {"status": "idle"}

@app.post("/api/chat/send")
def chat_send(req: ChatSendRequest):
    room = ROOMS.get(req.roomId)
    if not room:
        return JSONResponse(status_code=404, content={"error": "Active chat room not found or session ended."})
    message = {
        "id": f"msg_py_{int(time.time() * 1000)}_{random.randint(100, 999)}",
        "senderHandle": req.senderHandle,
        "senderAvatar": req.senderAvatar or "",
        "text": req.text,
        "timestamp": int(time.time() * 1000),
        "type": req.msgType,
    }
    room["messages"].append(message)
    return {"success": True, "message": message}

@app.post("/api/chat/edit")
def chat_edit(req: ChatEditRequest):
    room = ROOMS.get(req.roomId)
    if not room:
        return JSONResponse(status_code=404, content={"error": "Active chat room not found or session ended."})

    updated_text = req.text.strip()
    if not updated_text:
        return JSONResponse(status_code=400, content={"error": "Message text cannot be empty."})

    for message in room["messages"]:
        if message.get("id") == req.messageId:
            message["text"] = updated_text
            message["edited"] = True
            message["editedAt"] = int(time.time() * 1000)
            return {"success": True, "message": message}

    return JSONResponse(status_code=404, content={"error": "Message not found."})

@app.get("/api/chat/messages")
def chat_messages(roomId: str = "", since: int = 0, handle: str = ""):
    room = ROOMS.get(roomId)
    if not room:
        return {"active": False, "messages": [], "peerDisconnected": True, "isPeerTyping": False}
    new_msgs = [m for m in room["messages"] if m["timestamp"] > since]
    is_peer_typing = any(h != handle and typing for h, typing in room["typingState"].items())
    return {
        "active": True,
        "messages": new_msgs,
        "isPeerTyping": is_peer_typing,
        "peerDisconnected": room.get("peerDisconnected", False),
    }

@app.post("/api/chat/typing")
def chat_typing(req: ChatTypingRequest):
    room = ROOMS.get(req.roomId)
    if room and req.handle:
        room["typingState"][req.handle] = req.isTyping
    return {"success": True}

@app.post("/api/chat/leave")
def chat_leave(req: ChatLeaveRequest):
    room = ROOMS.pop(req.roomId, None) if req.roomId else None
    if room:
        # Purge the room and both peers' bindings so either student can rematch.
        _purge_room(room)
    elif req.sessionId:
        MATCHES.pop(req.sessionId, None)
    return {"success": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5050)
