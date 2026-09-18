"""Compatibility implementation of the current Node interest matcher.

This module is intentionally pure and shadow-only. It mirrors the live
`runtime.ts` selection rule so parity can be measured before it owns a queue.
"""

from __future__ import annotations

import re
from typing import Any

from .native_core import normalize_for_match

GENERIC_INTEREST = "general peer discovery"
STOP_WORDS = {"a", "an", "and", "at", "for", "i", "in", "into", "like", "love", "my", "of", "on", "or", "the", "to", "with"}


def _words(interests: list[str]) -> set[str]:
    return {
        word
        for interest in interests
        if interest.strip().lower() != GENERIC_INTEREST
        for word in re.findall(r"\w+", normalize_for_match(interest), flags=re.UNICODE)
        if len(word) > 1 and word not in STOP_WORDS
    }


def _score(candidate: dict[str, Any], peer: dict[str, Any]) -> tuple[int, str | None]:
    candidate_interests = [str(item) for item in candidate.get("interests", [])]
    peer_interests = [str(item) for item in peer.get("interests", [])]
    shared = _words(candidate_interests) & _words(peer_interests)
    if not shared:
        return 0, None
    normalized_peer = {interest.strip().lower() for interest in peer_interests}
    exact = next((interest for interest in candidate_interests
                  if interest.strip().lower() != GENERIC_INTEREST and interest.strip().lower() in normalized_peer), None)
    topic = exact or next(iter(shared)).title()
    return len(shared) + (100 if exact else 0), topic


def select_legacy_match(candidate: dict[str, Any], queued: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the peer Node would select, without mutating queue state."""
    eligible = [peer for peer in queued if peer.get("id") != candidate.get("id") and peer.get("verified") == candidate.get("verified")]
    scored = [(_score(candidate, peer), peer) for peer in eligible]
    scored = [(result, peer) for result, peer in scored if result[0] > 0]
    if scored:
        # Python's stable sort preserves the queue order for Node's equal-score ties.
        (score, topic), peer = sorted(scored, key=lambda item: item[0][0], reverse=True)[0]
        return {"peerId": peer["id"], "topic": topic, "score": score}
    if candidate.get("allowNormal"):
        peer = next((item for item in eligible if item.get("allowNormal")), None)
        if peer:
            return {"peerId": peer["id"], "topic": "General Peer Discovery", "score": 0}
    return None
