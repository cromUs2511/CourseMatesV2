// smoke.cpp - compiler-only test for the core. No Python, no pybind11, no CMake.
//
//   g++ -std=c++17 -O2 -Wall -Wextra -I src tests/smoke.cpp -o smoke && ./smoke
//
// Run this first when a build breaks: it separates "my C++ is wrong" from
// "my toolchain/pybind11 setup is wrong", which are very different afternoons.

#include <cassert>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

#include "content_filter.hpp"
#include "match_queue.hpp"
#include "rate_limiter.hpp"

static int g_failures = 0;

#define CHECK(cond, msg)                                              \
    do {                                                              \
        if (!(cond)) {                                                \
            std::printf("  FAIL: %s  (%s:%d)\n", msg, __FILE__, __LINE__); \
            ++g_failures;                                             \
        }                                                             \
    } while (0)

static void test_normalize() {
    std::printf("normalize\n");
    using namespace cm;
    CHECK(normalize("Hello, World!", NormMode::Spaced).text == "hello world", "basic spaced");
    CHECK(normalize("F.U.C.K", NormMode::Spaced).text == "f u c k", "punctuation is a break");
    CHECK(normalize("F.U.C.K", NormMode::Squashed).text == "fuck", "squashed drops breaks");
    CHECK(normalize("fuuuuck", NormMode::Squashed).text == "fuck", "squashed collapses runs");
    CHECK(normalize("pass", NormMode::Squashed).text == "pas", "collapse is symmetric");
    CHECK(normalize("h3ll0", NormMode::Spaced).text == "hello", "leetspeak");
    CHECK(normalize("\xC3\xA9t\xC3\xA9", NormMode::Spaced).text == "ete", "latin-1 accents");
    // U+200B zero width space must NOT create a word break.
    CHECK(normalize("fu\xE2\x80\x8B" "ck", NormMode::Spaced).text == "fuck", "zero-width is ignored");
    CHECK(normalize("", NormMode::Spaced).text.empty(), "empty input");
    // Truncated UTF-8 must terminate rather than over-read.
    CHECK(normalize("\xE2\x80", NormMode::Spaced).text.empty(), "truncated utf-8 is safe");
}

static void test_filter() {
    std::printf("content filter\n");
    using namespace cm;
    ContentFilter f;
    f.load({
        PatternSpec{"ass", "profanity", 2, /*whole_word=*/true, /*aggressive=*/false},
        PatternSpec{"spam link", "spam", 3, true, true},
        PatternSpec{"kill yourself", "self_harm", 3, true, true},
        PatternSpec{"idiot", "harassment", 1, true, true},
    });

    CHECK(f.scan("this is a classic assignment").action == kAllow,
          "no Scunthorpe: classic/assignment stay clean");
    CHECK(f.scan("you ass").action == kMask, "whole-word profanity is masked");
    CHECK(f.scan("k i l l   y o u r s e l f").action == kBlock,
          "aggressive pattern survives spacing evasion");
    CHECK(f.scan("1d10t").action == kFlag, "leetspeak folds to the pattern");
    CHECK(f.scan("perfectly normal message").action == kAllow, "clean text is untouched");

    const Verdict v = f.scan("you ass and idiot");
    CHECK(v.max_severity == 2, "verdict takes the max severity");
    CHECK(v.hits.size() == 2, "both hits reported");

    // Offsets must point into the ORIGINAL bytes so the caller can mask.
    const Verdict o = f.scan("hey ass hey");
    CHECK(o.hits.size() == 1 && o.hits[0].start == 4 && o.hits[0].end == 7, "byte offsets");

    CHECK(f.redact("you ass") == "you ***", "redact masks the span");
    CHECK(f.redact("nothing here") == "nothing here", "redact is a no-op when clean");

    // A reload must not corrupt a filter that is already in use.
    f.load({PatternSpec{"newword", "test", 3, true, false}});
    CHECK(f.scan("you ass").action == kAllow, "old patterns gone after reload");
    CHECK(f.scan("a newword here").action == kBlock, "new patterns live after reload");

    ContentFilter empty;
    CHECK(empty.scan("anything at all").action == kAllow, "empty filter allows everything");
}

static void test_rate_limiter() {
    std::printf("rate limiter\n");
    using namespace cm;
    RateConfig cfg;
    cfg.capacity = 3;
    cfg.refill_per_sec = 1000;  // refills fast so the test does not sleep long
    cfg.strikes_to_block = 2;
    cfg.base_block_ms = 50;

    RateLimiter rl(cfg, 8);
    CHECK(rl.allow("s1").allowed, "first token");
    CHECK(rl.allow("s1").allowed, "second token");
    CHECK(rl.allow("s1").allowed, "third token");
    const RateDecision d4 = rl.allow("s1");
    CHECK(!d4.allowed, "bucket exhausted");
    CHECK(d4.strikes == 1, "strike recorded");
    CHECK(d4.retry_after_ms > 0, "retry hint given");

    const RateDecision d5 = rl.allow("s1");
    CHECK(d5.blocked, "second strike opens the penalty box");

    CHECK(rl.allow("s2").allowed, "other keys are unaffected");

    std::this_thread::sleep_for(std::chrono::milliseconds(120));
    CHECK(rl.allow("s1").allowed, "sentence expires and the bucket refills");

    CHECK(rl.size() == 2, "two keys tracked");
    rl.reset("s2");
    CHECK(rl.size() == 1, "reset drops a key");
    CHECK(rl.gc(0) >= 1, "gc reclaims idle buckets");
}

static cm::Candidate mk(const std::string& id, const std::string& disc,
                        std::vector<std::string> interests, bool general = true) {
    cm::Candidate c;
    c.session_id = id;
    c.verified = true;
    c.campus = "Main Campus";
    c.discipline = disc;
    c.year = 2;
    c.topic = "General Peer Discovery";
    c.interests = std::move(interests);
    c.allow_general = general;
    return c;
}

static void test_match_queue() {
    std::printf("match queue\n");
    using namespace cm;
    MatchQueue q;

    CHECK(!q.enqueue(mk("a", "CS", {"Coding, DSA & Software"})).matched, "first joiner waits");
    CHECK(q.size() == 1, "queued");
    CHECK(q.position("a") == 1, "position is 1-based");

    const MatchResult r = q.enqueue(mk("b", "CS", {"Coding, DSA & Software"}));
    CHECK(r.matched && r.peer_session_id == "a", "second joiner pairs with the first");
    CHECK(r.score > 0, "score reported");
    CHECK(q.size() == 0, "both left the queue");

    // Verified and demo pools must never mix.
    Candidate demo = mk("demo", "CS", {"Coding, DSA & Software"});
    demo.verified = false;
    q.enqueue(demo);
    CHECK(!q.enqueue(mk("ver", "CS", {"Coding, DSA & Software"})).matched,
          "verified never pairs with demo");
    CHECK(q.size() == 2, "both still waiting");
    q.clear();

    // Better affinity must beat worse affinity. The stranger is queued first,
    // so a naive FIFO would hand them the match.
    q.enqueue(mk("stranger", "Nursing", {"Anatomy"}));
    q.enqueue(mk("peer", "CS", {"Coding, DSA & Software"}));
    const MatchResult pick = q.enqueue(mk("me", "CS", {"Coding, DSA & Software"}));
    CHECK(pick.matched && pick.peer_session_id == "peer", "best affinity wins");
    q.clear();

    // Opting out of the general pool means no match without real affinity.
    q.enqueue(mk("picky1", "CS", {"Quantum Computing"}, /*general=*/false));
    CHECK(!q.enqueue(mk("picky2", "Nursing", {"Anatomy"}, false)).matched,
          "no affinity and no general opt-in means no match");
    q.clear();

    // Re-joining keeps the original place in line.
    q.enqueue(mk("rejoin", "CS", {"Coding"}));
    const std::size_t slots_before = q.stats().slots;
    q.enqueue(mk("rejoin", "CS", {"Coding", "Databases"}));
    CHECK(q.size() == 1, "re-join does not duplicate the entry");
    CHECK(q.stats().slots == slots_before, "re-join reuses the slot");
    q.clear();

    // Two students with nothing in common must NOT pair instantly - they hold
    // out for general_hold_ms first, so a better match still has time to arrive.
    MatchWeights held;
    held.general_hold_ms = 80;
    MatchQueue hq(held);
    hq.enqueue(mk("lonely1", "Nursing", {"Anatomy"}));
    CHECK(!hq.enqueue(mk("lonely2", "Law", {"Torts"})).matched,
          "strangers hold out before settling");
    std::this_thread::sleep_for(std::chrono::milliseconds(120));
    CHECK(hq.enqueue(mk("lonely3", "Arts", {"Painting"})).matched,
          "after the hold-out window a stranger is acceptable");
    hq.clear();

    // Batch sweep: 10 mutually-unrelated students, all past the hold-out window.
    for (int i = 0; i < 10; ++i) {
        hq.enqueue(mk("u" + std::to_string(i), "D" + std::to_string(i), {"I" + std::to_string(i)}));
    }
    CHECK(hq.size() == 10, "nobody paired at enqueue time");
    std::this_thread::sleep_for(std::chrono::milliseconds(120));
    CHECK(hq.drain(100).size() == 5, "drain pairs everyone off");
    CHECK(hq.size() == 0, "queue emptied by drain");

    // Odd queue leaves exactly one waiting.
    for (int i = 0; i < 7; ++i) {
        hq.enqueue(mk("v" + std::to_string(i), "E" + std::to_string(i), {"J" + std::to_string(i)}));
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(120));
    CHECK(hq.drain(100).size() == 3, "odd queue yields floor(n/2) pairs");
    CHECK(hq.size() == 1, "one student left waiting");

    // max_pairs is respected.
    hq.clear();
    for (int i = 0; i < 8; ++i) {
        hq.enqueue(mk("w" + std::to_string(i), "F" + std::to_string(i), {"K" + std::to_string(i)}));
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(120));
    CHECK(hq.drain(2).size() == 2, "drain honours max_pairs");
    CHECK(hq.size() == 4, "the rest stay queued");

    // Expiry and removal.
    q.enqueue(mk("stale", "CS", {"Coding"}));
    CHECK(q.expire(0).size() == 1, "expire evicts");
    CHECK(q.size() == 0, "queue empty after expire");
    q.enqueue(mk("leaver", "CS", {"Coding"}));
    CHECK(q.remove("leaver"), "remove succeeds");
    CHECK(!q.remove("leaver"), "remove is idempotent");
    CHECK(q.position("ghost") == 0, "unknown session has no position");
}

static void test_queue_churn() {
    std::printf("match queue churn (slot reuse / stale index refs)\n");
    using namespace cm;
    MatchQueue q;
    // Hammer attach/detach so freed slots get recycled under stale index refs.
    for (int round = 0; round < 200; ++round) {
        for (int i = 0; i < 20; ++i) {
            q.enqueue(mk("c" + std::to_string(round * 20 + i), "CS", {"Coding, DSA"}));
        }
        q.drain(50);
        q.expire(0);
    }
    CHECK(q.size() == 0, "no entries leak across churn");
    CHECK(q.stats().slots < 64, "slots are recycled rather than grown unboundedly");
}

int main() {
    test_normalize();
    test_filter();
    test_rate_limiter();
    test_match_queue();
    test_queue_churn();
    if (g_failures == 0) {
        std::printf("\nOK - all smoke tests passed\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
