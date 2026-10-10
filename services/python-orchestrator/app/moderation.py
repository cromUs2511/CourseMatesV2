"""Shared native moderation rules, exposed only for internal shadow checks."""

from native_bridge import build_filter

_filter = build_filter()


def moderate_text(text: str) -> dict[str, object]:
    verdict = _filter.scan(text)
    return {"allowed": bool(verdict.allowed), "categories": list(verdict.categories)}
