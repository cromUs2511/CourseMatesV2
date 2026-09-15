"""Single import point for the C++ core, with a pure-Python safety net.

The rest of the app imports from here and never from `coursemates_native`
directly. That gives us one place to answer the two questions that matter in
production:

  1. Is the extension actually loaded?           -> NATIVE_AVAILABLE
  2. What happens on a machine where it is not?  -> degraded, not dead

The fallbacks are NOT drop-in equivalents. They are the same *policy* at a
fraction of the throughput and, for the filter, with weaker de-obfuscation.
They exist so a missing wheel degrades the service instead of taking it down --
a teammate on an unbuilt checkout, a fresh CI runner, a rollback mid-deploy.
Treat NATIVE_AVAILABLE == False in production as an alert, not a shrug.
"""

from __future__ import annotations

import faulthandler
import os
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

# A C++ segfault cannot be caught, but it can be made legible: this prints a
# native stack trace to stderr instead of a silent exit code 139 / 0xC0000005.
faulthandler.enable()

try:
    import coursemates_native as _native_module

    # Typed as Any: the checker cannot tie `_cn` being set to NATIVE_AVAILABLE.
    _cn: Any = _native_module
    NATIVE_AVAILABLE = True
    NATIVE_VERSION = _cn.__version__
except ImportError:  # pragma: no cover - exercised on unbuilt checkouts
    _cn = None
    NATIVE_AVAILABLE = False
    NATIVE_VERSION = None

# Escape hatch: CM_DISABLE_NATIVE=1 forces the Python path. If the native core
# is ever suspected in an incident, this is the rollback -- no redeploy needed.
if os.environ.get("CM_DISABLE_NATIVE") == "1":
    NATIVE_AVAILABLE = False

ALLOW, FLAG, MASK, BLOCK = 0, 1, 2, 3


# ---------------------------------------------------------------------------
# Pattern list
#
# severity 1 = let it through but count it, 2 = mask the span, 3 = drop the
# message. `aggressive` also scans the de-obfuscated form ("k i l l"), which
# catches evasion at the cost of occasional false positives -- so reserve it
# for phrases that are never innocent.
# ---------------------------------------------------------------------------
DEFAULT_PATTERNS: list[dict[str, Any]] = [
    # Coordinated self-harm / threats: always drop, always de-obfuscate.
    {"phrase": "kill yourself", "category": "self_harm", "severity": 3, "aggressive": True},
    {"phrase": "kys", "category": "self_harm", "severity": 3, "aggressive": False},
    {"phrase": "i will find you", "category": "threat", "severity": 3, "aggressive": True},
    # Spam / scams / off-platform luring: the bot-flood signature.
    {"phrase": "free robux", "category": "spam", "severity": 3, "aggressive": True},
    {"phrase": "crypto giveaway", "category": "spam", "severity": 3, "aggressive": True},
    {"phrase": "add me on telegram", "category": "off_platform", "severity": 3, "aggressive": True},
    {"phrase": "onlyfans", "category": "off_platform", "severity": 3, "aggressive": True},
    {"phrase": "exam answers for sale", "category": "academic_integrity", "severity": 3,
     "aggressive": True},
    # Harassment: masked, not dropped, so the conversation can continue.
    {"phrase": "idiot", "category": "harassment", "severity": 2, "aggressive": False},
    {"phrase": "stupid", "category": "harassment", "severity": 1, "aggressive": False},
    # PII the platform does not want in an anonymous room. Counted, not blocked,
    # so a student sharing a study-group email is nudged rather than silenced.
    {"phrase": "my student number is", "category": "pii", "severity": 1, "aggressive": False},
]


# ---------------------------------------------------------------------------
# Pure-Python fallbacks
# ---------------------------------------------------------------------------

_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
                       "7": "t", "@": "a", "$": "s", "|": "i"})
_INVISIBLE = dict.fromkeys(
    map(ord, "​‌‍‎‏﻿­⁠͏"), None)


def _fold(text: str, squashed: bool = False) -> str:
    """Approximate the C++ normaliser. NFKD covers fullwidth + math alphanumerics."""
    t = unicodedata.normalize("NFKD", text).translate(_INVISIBLE)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = t.lower().translate(_LEET)
    if squashed:
        t = re.sub(r"[^a-z0-9]+", "", t)
        return re.sub(r"(.)\1+", r"\1", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


@dataclass
class _PyHit:
    pattern_id: int
    phrase: str
    category: str
    severity: int
    start: int = -1  # the fallback does not track offsets
    end: int = -1


@dataclass
class _PyVerdict:
    action: int = ALLOW
    max_severity: int = 0
    hits: list[_PyHit] = field(default_factory=list)

    @property
    def allowed(self) -> bool:
        return self.action < BLOCK

    @property
    def categories(self) -> list[str]:
        return list(dict.fromkeys(h.category for h in self.hits))


class _PyContentFilter:
    """Regex-alternation stand-in. Linear in pattern count, unlike Aho-Corasick."""

    def __init__(self) -> None:
        self._specs: list[dict[str, Any]] = []
        self._spaced: re.Pattern[str] | None = None
        self._squashed: re.Pattern[str] | None = None
        self._lock = threading.Lock()

    def load(self, specs: Iterable[Any]) -> None:
        norm = [_as_dict(s) for s in specs]
        spaced_parts, squashed_parts = [], []
        for i, s in enumerate(norm):
            folded = _fold(s["phrase"])
            if not folded:
                continue
            body = re.escape(folded)
            bound = rf"(?<![a-z0-9]){body}(?![a-z0-9])" if s.get("whole_word", True) else body
            spaced_parts.append(f"(?P<p{i}>{bound})")
            if s.get("aggressive"):
                squashed_parts.append(f"(?P<p{i}>{re.escape(_fold(s['phrase'], True))})")
        with self._lock:
            self._specs = norm
            self._spaced = re.compile("|".join(spaced_parts)) if spaced_parts else None
            self._squashed = re.compile("|".join(squashed_parts)) if squashed_parts else None

    def scan(self, text: str) -> _PyVerdict:
        with self._lock:
            specs, spaced, squashed = self._specs, self._spaced, self._squashed
        v = _PyVerdict()
        if not specs or not text:
            return v
        seen: set[int] = set()
        for rx, mode in ((spaced, False), (squashed, True)):
            if rx is None:
                continue
            for m in rx.finditer(_fold(text, mode)):
                idx = int(m.lastgroup[1:])  # type: ignore[union-attr]
                if idx in seen:
                    continue
                seen.add(idx)
                s = specs[idx]
                v.hits.append(_PyHit(idx, s["phrase"], s.get("category", "generic"),
                                     int(s.get("severity", 2))))
                v.max_severity = max(v.max_severity, int(s.get("severity", 2)))
        v.action = v.max_severity
        return v

    def redact(self, text: str, mask: str = "*") -> str:
        out = text
        for hit in self.scan(text).hits:
            if hit.severity < MASK:
                continue
            out = re.sub(re.escape(hit.phrase), lambda m: mask * len(m.group()), out,
                         flags=re.IGNORECASE)
        return out

    @property
    def pattern_count(self) -> int:
        return len(self._specs)

    @property
    def node_count(self) -> int:
        return 0


@dataclass
class _PyDecision:
    allowed: bool
    blocked: bool
    tokens_left: float
    retry_after_ms: int
    strikes: int

    def __bool__(self) -> bool:
        return self.allowed


class _PyRateLimiter:
    def __init__(self, capacity: float = 12.0, refill_per_sec: float = 4.0,
                 strikes_to_block: int = 5, base_block_ms: int = 2000,
                 max_block_ms: int = 300_000, strike_decay_ms: int = 60_000) -> None:
        self.capacity = capacity
        self.refill = refill_per_sec
        self.strikes_to_block = strikes_to_block
        self.base_block_ms = base_block_ms
        self.max_block_ms = max_block_ms
        self.strike_decay_ms = strike_decay_ms
        self._b: dict[str, list[float]] = {}  # tokens, last, seen, strike_at, until, strikes
        self._lock = threading.Lock()

    def allow(self, key: str, cost: float = 1.0) -> _PyDecision:
        now = time.monotonic() * 1000.0
        with self._lock:
            b = self._b.get(key)
            if b is None:
                b = [self.capacity, now, now, 0.0, 0.0, 0.0]
                self._b[key] = b
            b[2] = now
            if b[4] > now:
                return _PyDecision(False, True, b[0], int(b[4] - now), int(b[5]))
            b[0] = min(self.capacity, b[0] + (now - b[1]) / 1000.0 * self.refill)
            b[1] = now
            if b[5] and now - b[3] > self.strike_decay_ms:
                b[5] = 0.0
            if b[0] >= cost:
                b[0] -= cost
                return _PyDecision(True, False, b[0], 0, int(b[5]))
            b[5] += 1
            b[3] = now
            retry = int((cost - b[0]) / max(1e-9, self.refill) * 1000.0) + 1
            if b[5] >= self.strikes_to_block:
                over = min(int(b[5]) - self.strikes_to_block, 20)
                retry = min(self.max_block_ms, self.base_block_ms << over)
                b[4] = now + retry
                return _PyDecision(False, True, b[0], retry, int(b[5]))
            return _PyDecision(False, False, b[0], retry, int(b[5]))

    def peek(self, key: str) -> _PyDecision:
        return self.allow(key, 0.0)

    def reset(self, key: str) -> None:
        with self._lock:
            self._b.pop(key, None)

    def gc(self, idle_ms: int = 600_000) -> int:
        now = time.monotonic() * 1000.0
        with self._lock:
            dead = [k for k, b in self._b.items()
                    if now - b[2] >= idle_ms and b[4] <= now]
            for k in dead:
                del self._b[k]
        return len(dead)

    def __len__(self) -> int:
        return len(self._b)

    @property
    def size(self) -> int:
        return len(self._b)


@dataclass
class _PyCandidate:
    session_id: str
    verified: bool = False
    campus: str = ""
    discipline: str = ""
    year: int = 0
    topic: str = ""
    interests: Sequence[str] = ()
    allow_general: bool = True


@dataclass
class _PyMatchResult:
    matched: bool = False
    peer_session_id: str = ""
    topic: str = ""
    score: float = 0.0
    peer_wait_ms: int = 0
    self_wait_ms: int = 0

    def __bool__(self) -> bool:
        return self.matched


@dataclass
class _PyMatchPair:
    a: str
    b: str
    topic: str
    score: float


@dataclass
class _PyQueueStats:
    waiting: int
    slots: int
    token_buckets: int
    oldest_wait_ms: int


_STOP = {"and", "the", "for", "with", "our", "your", "from", "into", "about",
         "general", "peer", "discovery", "other", "stuff", "things"}


class _PyMatchQueue:
    """Linear-scan stand-in. O(n) per join instead of O(bucket)."""

    def __init__(self, weights: Any = None,
                 general_topic: str = "General Peer Discovery") -> None:
        self.w = weights or _cn_weights()
        self.general = _fold(general_topic)
        self._q: list[dict[str, Any]] = []
        self._lock = threading.RLock()

    def _entry(self, c: Any, since: float) -> dict[str, Any]:
        exact, words = set(), set()
        for raw in getattr(c, "interests", ()) or ():
            f = _fold(raw)
            if not f:
                continue
            exact.add(f)
            words.update(t for t in f.split() if len(t) >= 3 and t not in _STOP)
        return {"c": c, "since": since, "exact": exact, "words": words,
                "topic": _fold(getattr(c, "topic", "") or ""),
                "campus": _fold(getattr(c, "campus", "") or ""),
                "disc": _fold(getattr(c, "discipline", "") or "")}

    def _score(self, me: dict[str, Any], other: dict[str, Any], now: float) -> float:
        if bool(me["c"].verified) != bool(other["c"].verified):
            return -1.0
        w, s, affinity = self.w, 0.0, False
        if me["topic"] and me["topic"] == other["topic"] and me["topic"] != self.general:
            s += w.topic_exact
            affinity = True
        interest = (len(me["exact"] & other["exact"]) * w.interest_exact
                    + len(me["words"] & other["words"]) * w.interest_word)
        if interest:
            s += min(interest, w.interest_cap)
            affinity = True
        if me["disc"] and me["disc"] == other["disc"]:
            s += w.same_discipline
            affinity = True
        if me["campus"] and me["campus"] == other["campus"]:
            s += w.same_campus
        ya, yb = me["c"].year, other["c"].year
        if ya > 0 and yb > 0:
            s += max(0.0, w.year_same - w.year_step_penalty * abs(ya - yb))
        if not affinity:
            if not (me["c"].allow_general and other["c"].allow_general):
                return -1.0
            if max(now - me["since"], now - other["since"]) < w.general_hold_ms:
                return -1.0
        return s + w.aging_per_sec * (now - other["since"]) / 1000.0

    def _best(self, me: dict[str, Any], now: float, skip: int = -1) -> int:
        best, best_score = -1, 0.0
        for i, other in enumerate(self._q):
            if i == skip or other["c"].session_id == me["c"].session_id:
                continue
            sc = self._score(me, other, now)
            if sc < 0:
                continue
            if best < 0 or sc > best_score:
                best, best_score = i, sc
        self._last_score = best_score
        return best

    def enqueue(self, c: Any) -> _PyMatchResult:
        now = time.monotonic() * 1000.0
        with self._lock:
            since = now
            for i, e in enumerate(self._q):
                if e["c"].session_id == c.session_id:
                    since = e["since"]
                    del self._q[i]
                    break
            me = self._entry(c, since)
            idx = self._best(me, now)
            if idx >= 0:
                peer = self._q.pop(idx)
                return _PyMatchResult(True, peer["c"].session_id,
                                      self._topic(me, peer), self._last_score,
                                      int(now - peer["since"]), int(now - since))
            self._q.append(me)
            return _PyMatchResult()

    def _topic(self, a: dict[str, Any], b: dict[str, Any]) -> str:
        for e in (a, b):
            t = getattr(e["c"], "topic", "") or ""
            if t and _fold(t) != self.general:
                return t
        return getattr(a["c"], "topic", "") or getattr(b["c"], "topic", "") or ""

    def remove(self, session_id: str) -> bool:
        with self._lock:
            for i, e in enumerate(self._q):
                if e["c"].session_id == session_id:
                    del self._q[i]
                    return True
        return False

    def contains(self, session_id: str) -> bool:
        return any(e["c"].session_id == session_id for e in self._q)

    def position(self, session_id: str) -> int:
        with self._lock:
            for e in self._q:
                if e["c"].session_id == session_id:
                    return sum(1 for o in self._q if o["since"] < e["since"]) + 1
        return 0

    def wait_ms(self, session_id: str) -> int:
        now = time.monotonic() * 1000.0
        with self._lock:
            for e in self._q:
                if e["c"].session_id == session_id:
                    return int(now - e["since"])
        return 0

    def drain(self, max_pairs: int = 256) -> list[_PyMatchPair]:
        now = time.monotonic() * 1000.0
        pairs: list[_PyMatchPair] = []
        with self._lock:
            self._q.sort(key=lambda e: e["since"])
            i = 0
            while i < len(self._q) and len(pairs) < max_pairs:
                idx = self._best(self._q[i], now, skip=i)
                if idx < 0:
                    i += 1
                    continue
                a, b = self._q[i], self._q[idx]
                pairs.append(_PyMatchPair(a["c"].session_id, b["c"].session_id,
                                          self._topic(a, b), self._last_score))
                for j in sorted((i, idx), reverse=True):
                    del self._q[j]
        return pairs

    def expire(self, max_age_ms: int) -> list[str]:
        now = time.monotonic() * 1000.0
        with self._lock:
            gone = [e["c"].session_id for e in self._q if now - e["since"] >= max_age_ms]
            self._q = [e for e in self._q if now - e["since"] < max_age_ms]
        return gone

    def clear(self) -> None:
        with self._lock:
            self._q.clear()

    def stats(self) -> _PyQueueStats:
        now = time.monotonic() * 1000.0
        with self._lock:
            oldest = max((now - e["since"] for e in self._q), default=0)
            return _PyQueueStats(len(self._q), len(self._q), 0, int(oldest))

    def __len__(self) -> int:
        return len(self._q)

    @property
    def size(self) -> int:
        return len(self._q)


@dataclass
class _PyRateConfig:
    capacity: float = 12.0
    refill_per_sec: float = 4.0
    strikes_to_block: int = 5
    base_block_ms: int = 2000
    max_block_ms: int = 300_000
    strike_decay_ms: int = 60_000


@dataclass
class _PyWeights:
    topic_exact: float = 1000.0
    interest_exact: float = 400.0
    interest_word: float = 110.0
    interest_cap: float = 900.0
    same_discipline: float = 150.0
    same_campus: float = 60.0
    year_same: float = 80.0
    year_step_penalty: float = 30.0
    aging_per_sec: float = 8.0
    general_hold_ms: int = 8000
    max_scan: int = 512


def _cn_weights() -> Any:
    return _cn.MatchWeights() if NATIVE_AVAILABLE else _PyWeights()


def _as_dict(spec: Any) -> dict[str, Any]:
    if isinstance(spec, dict):
        return spec
    return {"phrase": spec.phrase, "category": spec.category, "severity": spec.severity,
            "whole_word": spec.whole_word, "aggressive": spec.aggressive}


# ---------------------------------------------------------------------------
# Public surface - identical names whichever implementation is live
# ---------------------------------------------------------------------------

if NATIVE_AVAILABLE:
    Candidate = _cn.Candidate
    MatchWeights = _cn.MatchWeights
    RateConfig = _cn.RateConfig
else:
    Candidate = _PyCandidate       # type: ignore[misc,assignment]
    MatchWeights = _PyWeights      # type: ignore[misc,assignment]
    RateConfig = _PyRateConfig     # type: ignore[misc,assignment]


def build_filter(patterns: Iterable[dict[str, Any]] | None = None) -> Any:
    """Compiled abuse filter, native if available."""
    specs = list(patterns if patterns is not None else DEFAULT_PATTERNS)
    if NATIVE_AVAILABLE:
        f = _cn.ContentFilter()
        f.load([_cn.PatternSpec(
            s["phrase"],
            category=s.get("category", "generic"),
            severity=int(s.get("severity", 2)),
            whole_word=bool(s.get("whole_word", True)),
            aggressive=bool(s.get("aggressive", False)),
        ) for s in specs])
        return f
    f = _PyContentFilter()
    f.load(specs)
    return f


def build_rate_limiter(capacity: float = 12.0, refill_per_sec: float = 4.0,
                       **kw: Any) -> Any:
    """Token bucket. Defaults: 12-message burst, 4/s sustained."""
    if NATIVE_AVAILABLE:
        return _cn.RateLimiter(_cn.RateConfig(capacity=capacity,
                                              refill_per_sec=refill_per_sec, **kw))
    return _PyRateLimiter(capacity=capacity, refill_per_sec=refill_per_sec, **kw)


def build_match_queue(general_hold_ms: int = 8000, **kw: Any) -> Any:
    """Matchmaking queue. general_hold_ms is the hold-out before settling."""
    w = _cn_weights()
    w.general_hold_ms = general_hold_ms
    for k, v in kw.items():
        setattr(w, k, v)
    if NATIVE_AVAILABLE:
        return _cn.MatchQueue(w)
    return _PyMatchQueue(w)


def make_candidate(session_id: str, **kw: Any) -> Any:
    if NATIVE_AVAILABLE:
        kw.setdefault("interests", [])
        return _cn.Candidate(session_id, **kw)
    return _PyCandidate(session_id, **kw)


def status() -> dict[str, Any]:
    """For /api/health, so "is the fast path live?" is answerable in prod."""
    return {
        "native": NATIVE_AVAILABLE,
        "version": NATIVE_VERSION if NATIVE_AVAILABLE else None,
        "implementation": "c++" if NATIVE_AVAILABLE else "python-fallback",
    }
