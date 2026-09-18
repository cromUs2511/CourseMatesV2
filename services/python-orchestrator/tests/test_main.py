from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app
from app.matching import select_legacy_match


def test_health_reports_the_versioned_shadow_capability() -> None:
    response = TestClient(app).get("/internal/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["contractVersion"] == 1
    assert body["mode"] == "shadow-only"
    assert body["capabilities"] == ["icebreakers", "native-match-normalization"]
    assert body["native"]["implementation"] in {"c++", "python-test-fallback"}


def test_icebreakers_returns_four_local_items() -> None:
    response = TestClient(app).post(
        "/internal/v1/icebreakers",
        json={
            "contractVersion": 1,
            "topic": "Calculus",
            "discipline": "Engineering",
            "campus": "Main Campus",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["contractVersion"] == 1
    assert body["source"] == "python-local-fallback"
    assert len(body["icebreakers"]) == 4
    assert all(isinstance(item, str) and item for item in body["icebreakers"])


def test_legacy_match_selection_prefers_exact_interest_and_keeps_auth_pools_separate() -> None:
    result = select_legacy_match(
        {"id": "new", "verified": True, "interests": ["Calculus"], "allowNormal": False},
        [
            {"id": "demo", "verified": False, "interests": ["Calculus"], "allowNormal": True},
            {"id": "partial", "verified": True, "interests": ["Applied Calculus"], "allowNormal": True},
            {"id": "exact", "verified": True, "interests": ["Calculus"], "allowNormal": True},
        ],
    )

    assert result == {"peerId": "exact", "topic": "Calculus", "score": 101}


def test_match_shadow_endpoint_returns_a_legacy_compatible_selection() -> None:
    response = TestClient(app).post(
        "/internal/v1/match/select",
        json={
            "contractVersion": 1,
            "candidate": {"id": "new", "verified": True, "interests": ["Calculus"], "allowNormal": False},
            "queued": [{"id": "peer", "verified": True, "interests": ["Calculus"], "allowNormal": True}],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"contractVersion": 1, "selection": {"peerId": "peer", "topic": "Calculus", "score": 101}}
