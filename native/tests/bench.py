"""Benchmark the native core against the pure-Python fallback.

    python tests/bench.py

Prints per-call latency for the three hot paths. Use these numbers to decide
whether a piece is worth moving to C++ at all - and to sanity-check the claim
that an in-process call beats a gRPC/Redis hop by two orders of magnitude.
"""

from __future__ import annotations

import random
import statistics
import string
import sys
import time

try:
    import coursemates_native as cn
except ImportError:
    sys.exit("coursemates_native is not built. See native/README.md.")

sys.path.insert(0, "..")
try:
    from native_bridge import _PyContentFilter, _PyMatchQueue, _PyRateLimiter
except ImportError:
    _PyContentFilter = _PyMatchQueue = _PyRateLimiter = None


BANNED = [
    "kill yourself", "free robux", "click here now", "onlyfans", "crypto giveaway",
    "nude pics", "add me on telegram", "cheap essay", "exam answers leaked",
] + ["badword%03d" % i for i in range(300)]

WORDS = ["study", "midterm", "calculus", "lecture", "review", "notes", "library",
         "professor", "deadline", "project", "thesis", "lab", "quiz", "seminar"]


READING = """
Reading these numbers
---------------------
* The filter is where C++ earns its keep. String scanning is exactly the work
  CPython is worst at, and the cost is flat in pattern count -- 300 patterns
  cost the same as 3.
* The rate limiter is a wash per call. A token bucket is ~10 dict operations;
  the ~1us pybind11 call overhead eats the entire win. It stays in the native
  module for the GIL-free property and the compact memory layout, NOT for
  speed. Do not cite a speedup here.
* Matchmaking wins on algorithm (inverted index + capped scan), not on being
  C++. The same structure written in Python would also beat a linear scan.

A note on the fixtures: every candidate below uses a nonsense single-word
interest. An earlier version used 'Interest 7', 'Interest 12' and so on --
which all share the word token 'interest', so every pair looked related and
the queue emptied itself instead of filling up. Watch for that in production:
one generic word common to every interest string ('Studies', 'General') makes
everybody a match. Tune the stop-word list to your real interest vocabulary.

For scale: a gRPC round trip on loopback is ~150-400us and a Redis GET over
TCP is ~100-200us. Every number above is smaller than the cheapest possible
network hop, which is the argument for pybind11 over a sidecar at this size.
"""


def make_message(n_words: int = 30) -> str:
    return " ".join(random.choice(WORDS) for _ in range(n_words))


def timeit(label: str, fn, reps: int) -> float:
    fn()  # warm up
    samples = []
    for _ in range(7):
        start = time.perf_counter()
        for _ in range(reps):
            fn()
        samples.append((time.perf_counter() - start) / reps)
    best = min(samples)
    med = statistics.median(samples)
    print(f"  {label:<38} {best * 1e6:8.2f} us/call   (median {med * 1e6:.2f})")
    return best


def bench_filter() -> None:
    print("\ncontent filter -- %d patterns, 30-word message" % len(BANNED))
    specs = [cn.PatternSpec(p, severity=3, aggressive=True) for p in BANNED]
    native = cn.ContentFilter()
    native.load(specs)
    msg = make_message()
    print("  automaton nodes: %d" % native.node_count)
    c_time = timeit("native (C++ Aho-Corasick)", lambda: native.scan(msg), 20_000)

    if _PyContentFilter is None:
        return
    py = _PyContentFilter()
    py.load([{"phrase": p, "severity": 3, "aggressive": True} for p in BANNED])
    p_time = timeit("pure-Python fallback (regex alt)", lambda: py.scan(msg), 200)

    # The fairest baseline: what you would actually write in Python first.
    lowered = [b.lower() for b in BANNED]

    def naive() -> None:
        low = msg.lower()
        for b in lowered:
            if b in low:
                break

    n_time = timeit("naive Python substring loop", naive, 2_000)
    print(f"  vs regex fallback: {p_time / c_time:.0f}x   "
          f"vs naive loop: {n_time / c_time:.0f}x")


def bench_filter_long() -> None:
    print("\ncontent filter -- same patterns, 4 KB message")
    specs = [cn.PatternSpec(p, severity=3, aggressive=True) for p in BANNED]
    native = cn.ContentFilter()
    native.load(specs)
    msg = make_message(700)
    timeit("native (C++ Aho-Corasick)", lambda: native.scan(msg), 5_000)


def bench_rate_limiter() -> None:
    print("\nrate limiter -- 10k distinct keys")
    rl = cn.RateLimiter(cn.RateConfig(capacity=1e9, refill_per_sec=1e6))
    keys = ["sess-" + "".join(random.choices(string.ascii_lowercase, k=12))
            for _ in range(10_000)]
    i = [0]

    def call() -> None:
        i[0] = (i[0] + 1) % len(keys)
        rl.allow(keys[i[0]])

    c_time = timeit("native (sharded token bucket)", call, 50_000)

    if _PyRateLimiter is None:
        return
    py = _PyRateLimiter(capacity=1e9, refill_per_sec=1e6)
    j = [0]

    def pycall() -> None:
        j[0] = (j[0] + 1) % len(keys)
        py.allow(keys[j[0]])

    p_time = timeit("pure-Python fallback", pycall, 20_000)
    print(f"  speedup: {p_time / c_time:.1f}x")


def bench_match_queue() -> None:
    print("\nmatchmaking -- enqueue against a 5,000-deep queue")
    weights = cn.MatchWeights()
    weights.general_hold_ms = 10**9  # never settle, so the queue stays deep
    q = cn.MatchQueue(weights)

    # Every seed is mutually unmatchable (unique discipline AND unique interest),
    # so the queue actually fills up instead of pairing itself off. This is the
    # worst realistic case: a big queue of students with nothing in common.
    def seed(i: int) -> "cn.Candidate":
        return cn.Candidate(
            f"seed-{i}",
            verified=True,
            campus="Main",
            discipline=f"Discipline {i}",
            year=random.randint(1, 5),
            topic=f"Topic {i}",
            interests=[f"xyzzy{i}"],
        )

    for i in range(5_000):
        q.enqueue(seed(i))
    print("  queue depth: %d" % len(q))

    n = [10**6]

    def call() -> None:
        n[0] += 1
        q.enqueue(seed(n[0]))

    timeit("native, no affinity (worst case)", call, 5_000)
    print("  depth after probes: %d" % len(q))

    # And the realistic case: the joiner shares an interest with ~1/40th of the
    # queue, so the inverted index has a real bucket to scan.
    q2 = cn.MatchQueue(weights)
    for i in range(5_000):
        q2.enqueue(cn.Candidate(
            f"s-{i}", verified=True, campus="Main",
            discipline=f"Discipline {i % 6}", year=random.randint(1, 5),
            topic=f"Topic {i}", interests=[f"xyzzy{i % 40}"],
        ))
    m = [10**6]

    def call2() -> None:
        m[0] += 1
        q2.enqueue(cn.Candidate(
            f"p-{m[0]}", verified=True, campus="Main",
            discipline=f"Discipline {m[0] % 6}", year=random.randint(1, 5),
            topic=f"Topic {m[0]}", interests=[f"xyzzy{m[0] % 40}"],
        ))

    print("  queue depth: %d (shared interests, capped scan active)" % len(q2))
    timeit("native, shared interests", call2, 5_000)


def main() -> None:
    random.seed(7)
    print("coursemates_native", cn.__version__, "|", sys.version.split()[0])
    bench_filter()
    bench_filter_long()
    bench_rate_limiter()
    bench_match_queue()
    print(READING)


if __name__ == "__main__":
    main()
