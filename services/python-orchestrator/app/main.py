"""Shadow-only internal orchestration contract.

This service deliberately owns no browser session, room, queue, or WebSocket
state. Node remains the source of truth while responses are compared in shadow
mode.
"""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .matching import select_legacy_match
from .native_core import native_status

app = FastAPI(title="CourseMates Python Orchestrator", version="1.0.0")


class IcebreakerRequest(BaseModel):
    contractVersion: Literal[1]
    topic: str = Field(default="", max_length=2_000)
    discipline: str = Field(default="", max_length=2_000)
    campus: str = Field(default="", max_length=2_000)


class IcebreakerResponse(BaseModel):
    contractVersion: Literal[1] = 1
    source: Literal["python-local-fallback"] = "python-local-fallback"
    icebreakers: list[str]


class MatchParticipant(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    verified: bool
    interests: list[str] = Field(max_length=16)
    allowNormal: bool


class MatchSelectionRequest(BaseModel):
    contractVersion: Literal[1]
    candidate: MatchParticipant
    queued: list[MatchParticipant] = Field(max_length=10_000)


@app.get("/internal/v1/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "contractVersion": 1,
        "mode": "shadow-only",
        "capabilities": ["icebreakers", "native-match-normalization"],
        "native": native_status(),
    }


@app.post("/internal/v1/icebreakers", response_model=IcebreakerResponse)
def icebreakers(request: IcebreakerRequest) -> IcebreakerResponse:
    topic = request.topic.strip() or "your current study topic"
    return IcebreakerResponse(icebreakers=[
        f"What part of {topic} are you focusing on today?",
        "Which study method has been most useful for this subject?",
        "Is there a concept or assignment you want to compare approaches on?",
        "What would make this study session feel productive for you?",
    ])


@app.post("/internal/v1/match/select")
def match_select(request: MatchSelectionRequest) -> dict[str, object]:
    return {
        "contractVersion": 1,
        "selection": select_legacy_match(
            request.candidate.model_dump(),
            [participant.model_dump() for participant in request.queued],
        ),
    }
