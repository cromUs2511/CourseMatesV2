"""Python-level tests for coursemates_native.

    cd native && pip install -e . && pytest

These cover the pybind11 boundary specifically: argument conversion, the GIL
release (test_filter_releases_the_gil is the one that actually matters), and
that nothing leaks references or blows up under repeated calls. The C++ logic
itself is covered by tests/smoke.cpp, which needs no Python at all.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import pytest

cn = pytest.importorskip("coursemates_native")


# --------------------------------------------------------------------- filter

PATTERNS = [
    cn.PatternSpec("ass", category="profanity", severity=2),
    cn.PatternSpec("kill yourself", category="self_harm", severity=3, aggressive=True),
    cn.PatternSpec("free robux", category="spam", severity=3, aggressive=True),
    cn.PatternSpec("idiot", category="harassment", severity=1, aggressive=True),
]


@pytest.fixture()
def filt() -> Any:  # cn.ContentFilter
    f = cn.ContentFilter()
    f.load(PATTERNS)
    return f


def test_clean_text_passes(filt):
    v = filt.scan("hey, want to review the midterm together?")
    assert v.action == cn.ALLOW
    assert v.hits == []
    assert v.allowed


def test_no_false_positive_on_substring(filt):
    # The Scunthorpe problem. "classic assignment" must not trip "ass".
    assert filt.scan("this is a classic assignment").action == cn.ALLOW


def test_whole_word_profanity_is_masked(filt):
    v = filt.scan("you ass")
    assert v.action == cn.MASK
    assert v.hits[0].category == "profanity"
    assert filt.redact("you ass") == "you ***"


def test_obfuscation_is_defeated(filt):
    for evasion in (
        "k i l l  y o u r s e l f",
        "k.i.l.l y.o.u.r.s.e.l.f",
        "KILLLL YOURSELF",
        "ki​ll yourself",          # zero-width space
        "kіll yourself",           # Cyrillic i homoglyph
    ):
        assert filt.scan(evasion).action == cn.BLOCK, evasion


def test_leetspeak(filt):
    assert filt.scan("fr33 r0bux").action == cn.BLOCK


def test_hit_offsets_index_the_original_string(filt):
    text = "hey ass hey"
    hit = filt.scan(text).hits[0]
    assert text[hit.start : hit.end] == "ass"


def test_unicode_offsets_survive_multibyte_text(filt):
    text = "café ass café"
    hit = filt.scan(text).hits[0]
    assert text.encode()[hit.start : hit.end].decode() == "ass"


def test_categories_are_deduped(filt):
    assert set(filt.scan("you ass and idiot").categories) == {"profanity", "harassment"}


def test_reload_is_atomic(filt):
    filt.load([cn.PatternSpec("newword", severity=3)])
    assert filt.scan("you ass").action == cn.ALLOW
    assert filt.scan("a newword here").action == cn.BLOCK


def test_empty_filter_allows_everything():
    assert cn.ContentFilter().scan("anything").action == cn.ALLOW


def test_scan_is_pure(filt):
    # Zero-log: scanning must not retain or mutate anything observable.
    before = filt.pattern_count
    for _ in range(1000):
        filt.scan("you ass and idiot and free robux")
    assert filt.pattern_count == before


def test_filter_releases_the_gil(filt):
    """Two threads scanning must overlap in wall-clock time.

    If the GIL were held across scan(), total time would be ~2x a single
    thread's. This is the property the whole integration depends on.
    """
    big = ("lorem ipsum dolor sit amet " * 4000) + " you ass"
    reps = 20

    def work() -> None:
        for _ in range(reps):
            filt.scan(big)

    start = time.perf_counter()
    work()
    single = time.perf_counter() - start

    threads = [threading.Thread(target=work) for _ in range(2)]
    start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    parallel = time.perf_counter() - start

    # Serialised would be ~2.0x. Allow generous slack for CI noise.
    assert parallel < single * 1.7, f"single={single:.4f}s parallel={parallel:.4f}s"


# ---------------------------------------------------------------- rate limiter


def test_token_bucket_burst_then_throttle():
    rl = cn.RateLimiter(cn.RateConfig(capacity=5, refill_per_sec=1000))
    assert all(rl.allow("s1").allowed for _ in range(5))
    d = rl.allow("s1")
    assert not d.allowed
    assert d.retry_after_ms > 0
    assert bool(d) is False


def test_keys_are_independent():
    rl = cn.RateLimiter(cn.RateConfig(capacity=1, refill_per_sec=0.001))
    assert rl.allow("a").allowed
    assert not rl.allow("a").allowed
    assert rl.allow("b").allowed


def test_penalty_box_escalates():
    rl = cn.RateLimiter(cn.RateConfig(capacity=1, refill_per_sec=0.001, strikes_to_block=2,
                                      base_block_ms=50))
    rl.allow("flood")
    first = rl.allow("flood")
    assert not first.blocked          # strike 1: plain refusal
    second = rl.allow("flood")
    assert second.blocked             # strike 2: sentence starts
    third = rl.allow("flood")
    assert third.retry_after_ms >= second.retry_after_ms


def test_bucket_refills_over_time():
    rl = cn.RateLimiter(cn.RateConfig(capacity=1, refill_per_sec=50))
    assert rl.allow("s").allowed
    assert not rl.allow("s").allowed
    time.sleep(0.1)
    assert rl.allow("s").allowed


def test_gc_reclaims_idle_buckets():
    rl = cn.RateLimiter()
    for i in range(500):
        rl.allow(f"session-{i}")
    assert len(rl) == 500
    assert rl.gc(idle_ms=0) == 500
    assert len(rl) == 0


def test_limiter_is_thread_safe():
    rl = cn.RateLimiter(cn.RateConfig(capacity=10_000, refill_per_sec=0.001))
    granted = []
    lock = threading.Lock()

    def work() -> None:
        n = sum(1 for _ in range(2000) if rl.allow("shared").allowed)
        with lock:
            granted.append(n)

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # 16,000 attempts against a 10,000-token bucket: exactly 10,000 win.
    assert sum(granted) == 10_000


# ------------------------------------------------------------------ match queue


def candidate(sid: str, **kw) -> Any:  # cn.Candidate
    base = dict(
        verified=True,
        campus="Main Campus",
        discipline="Computer Science & IT",
        year=2,
        topic="General Peer Discovery",
        interests=["Coding, DSA & Software"],
        allow_general=True,
    )
    base.update(kw)
    return cn.Candidate(sid, **base)


def test_first_joiner_waits_second_matches():
    q = cn.MatchQueue()
    assert not q.enqueue(candidate("a")).matched
    assert q.position("a") == 1
    r = q.enqueue(candidate("b"))
    assert r.matched and r.peer_session_id == "a"
    assert len(q) == 0


def test_verified_and_demo_pools_never_mix():
    q = cn.MatchQueue()
    q.enqueue(candidate("demo", verified=False))
    assert not q.enqueue(candidate("verified", verified=True)).matched
    assert len(q) == 2


def test_best_affinity_beats_fifo_order():
    q = cn.MatchQueue()
    q.enqueue(candidate("stranger", discipline="Nursing", interests=["Anatomy"]))
    q.enqueue(candidate("peer"))
    r = q.enqueue(candidate("me"))
    assert r.matched and r.peer_session_id == "peer"


def test_shared_topic_outranks_everything():
    q = cn.MatchQueue()
    q.enqueue(candidate("generic"))
    q.enqueue(candidate("topical", topic="CS 101 Finals", interests=["Unrelated"],
                        discipline="Law"))
    r = q.enqueue(candidate("me", topic="CS 101 Finals"))
    assert r.matched and r.peer_session_id == "topical"


def test_strangers_hold_out_then_settle():
    w = cn.MatchWeights()
    w.general_hold_ms = 80
    q = cn.MatchQueue(w)
    q.enqueue(candidate("x", discipline="Nursing", interests=["Anatomy"]))
    assert not q.enqueue(candidate("y", discipline="Law", interests=["Torts"])).matched
    time.sleep(0.12)
    assert q.enqueue(candidate("z", discipline="Arts", interests=["Painting"])).matched


def test_opting_out_of_general_pool_means_no_match():
    q = cn.MatchQueue()
    q.enqueue(candidate("p1", discipline="Nursing", interests=["Anatomy"], allow_general=False))
    assert not q.enqueue(
        candidate("p2", discipline="Law", interests=["Torts"], allow_general=False)
    ).matched


def test_rejoin_keeps_place_in_line():
    q = cn.MatchQueue()
    q.enqueue(candidate("r"))
    time.sleep(0.05)
    q.enqueue(candidate("r", interests=["Coding, DSA & Software", "Databases"]))
    assert len(q) == 1
    assert q.wait_ms("r") >= 50


def test_drain_batches_leftovers():
    w = cn.MatchWeights()
    w.general_hold_ms = 50
    q = cn.MatchQueue(w)
    for i in range(9):
        q.enqueue(candidate(f"u{i}", discipline=f"D{i}", interests=[f"I{i}"]))
    assert len(q) == 9
    time.sleep(0.08)
    pairs = q.drain(100)
    assert len(pairs) == 4
    assert len(q) == 1
    assert all(p.a != p.b for p in pairs)


def test_expire_and_remove():
    q = cn.MatchQueue()
    q.enqueue(candidate("stale"))
    assert q.expire(0) == ["stale"]
    assert len(q) == 0
    q.enqueue(candidate("leaver"))
    assert q.remove("leaver")
    assert not q.remove("leaver")
    assert q.position("ghost") == 0


def test_queue_does_not_grow_unboundedly():
    q = cn.MatchQueue()
    for i in range(2000):
        q.enqueue(candidate(f"c{i}"))
    q.expire(0)
    assert len(q) == 0
    # Slots are recycled, not appended forever.
    assert q.stats().slots < 64


def test_queue_is_thread_safe():
    q = cn.MatchQueue()
    matched = []
    lock = threading.Lock()

    def work(base: int) -> None:
        local = 0
        for i in range(500):
            if q.enqueue(candidate(f"t{base}-{i}")).matched:
                local += 1
        with lock:
            matched.append(local)

    threads = [threading.Thread(target=work, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    total_matched = sum(matched)
    # Every match removes 2 students; the rest are still queued. Nobody is lost
    # and nobody is double-booked.
    assert total_matched * 2 + len(q) == 2000


# ------------------------------------------------------------------- utilities


@pytest.mark.parametrize(
    "raw,squashed,expected",
    [
        ("Hello, World!", False, "hello world"),
        ("F.U.C.K", False, "f u c k"),
        ("F.U.C.K", True, "fuck"),
        ("h3ll0", False, "hello"),
        ("café", False, "cafe"),
        ("", False, ""),
    ],
)
def test_normalize_text(raw, squashed, expected):
    assert cn.normalize_text(raw, squashed=squashed) == expected


def test_module_has_a_version():
    assert cn.__version__
