from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.main import app


def test_shadow_moderation_blocks_threats_and_returns_no_message_content() -> None:
    response = TestClient(app).post('/internal/v1/moderation', json={
        'contractVersion': 1, 'text': 'ＫＩＬＬ ＹＯＵＲＳＥＬＦ',
    })
    assert response.status_code == 200
    assert response.json() == {
        'contractVersion': 1, 'allowed': False, 'categories': ['self_harm'],
    }


def test_shadow_moderation_does_not_block_benign_course_words() -> None:
    response = TestClient(app).post('/internal/v1/moderation', json={
        'contractVersion': 1, 'text': 'Kysely database course and idiotypes in biology',
    })
    assert response.status_code == 200
    assert response.json()['allowed'] is True


def test_shadow_moderation_rejects_oversized_or_invalid_requests() -> None:
    client = TestClient(app)
    for body in [
        {'contractVersion': 1, 'text': 'x' * 4001},
        {'contractVersion': 2, 'text': 'hello'},
        {'contractVersion': 1, 'text': 123},
    ]:
        assert client.post('/internal/v1/moderation', json=body).status_code == 422
