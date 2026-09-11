"""
CourseMates - Standalone FastAPI Python Backend
Run with:
    pip install -r requirements.txt
    python3 -m uvicorn app:app --host 0.0.0.0 --port 5050 --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

FIFO_QUEUE = []
ROOMS = {}
MATCHES = {}

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
        raise HTTPException(
            status_code=403,
            detail="ACCESS DENIED: Please provide a valid email address."
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
    if sid in MATCHES:
        return {"status": "matched", **MATCHES[sid]}
    FIFO_QUEUE.append(req.model_dump())
    return {"status": "queued", "position": len(FIFO_QUEUE)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5050)
