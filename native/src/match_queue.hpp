// match_queue.hpp - priority-bucket matchmaking for anonymous 1-on-1 pairing.
//
// Why buckets and not maximum-weight graph matching:
//   True max-weight matching (Blossom, O(V^3)) needs a batch window, which
//   means every student waits for the window to close even when a perfect
//   partner is already sitting in the queue. Interactive chat wants the
//   opposite trade: match NOW if the match is good enough.
//
//   So: greedy best-first over an inverted index (interest token -> waiting
//   students), with a wait-time aging term folded into the score. Aging is what
//   keeps the greedy choice from starving anyone - a niche student's score
//   climbs until a general-pool partner beats every specific candidate.
//
//   drain() is the batch escape hatch: a periodic sweep that runs the same
//   scorer over everyone still waiting, which recovers most of the quality a
//   global matcher would buy, at O(n * max_scan) instead of O(n^3).
//
// Cost control: candidate gathering is capped at `max_scan`. A queue of 10,000
// still scores at most a few hundred candidates per join, so p99 join latency
// does not degrade as the campus wakes up.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "rate_limiter.hpp"   // steady_now_ms
#include "text_normalize.hpp"

namespace cm {

struct Candidate {
    std::string session_id;
    bool verified = false;          // verified and demo pools never mix
    std::string campus;
    std::string discipline;
    std::int32_t year = 0;          // 1..5; 0 = unknown, scores neutral
    std::string topic;
    std::vector<std::string> interests;
    bool allow_general = true;      // willing to be paired with no affinity
};

struct MatchWeights {
    double topic_exact = 1000.0;
    double interest_exact = 400.0;   // whole interest string matches
    double interest_word = 110.0;    // one shared word inside an interest
    double interest_cap = 900.0;     // ceiling on the interest contribution
    double same_discipline = 150.0;
    double same_campus = 60.0;
    double year_same = 80.0;
    double year_step_penalty = 30.0;
    double aging_per_sec = 8.0;      // anti-starvation: rank bonus per second waited

    // How long a student holds out for a peer with SOME affinity (shared topic,
    // shared interest, or same discipline) before the queue will pair them with
    // a stranger from the general pool. Set it to 0 to pair instantly and
    // accept worse matches; raise it to trade wait time for match quality.
    std::uint64_t general_hold_ms = 8000;

    std::uint32_t max_scan = 512;    // hard cap on candidates scored per join
};

struct MatchResult {
    bool matched = false;
    std::string peer_session_id;
    std::string topic;
    double score = 0.0;
    std::uint64_t peer_wait_ms = 0;
    std::uint64_t self_wait_ms = 0;
};

struct MatchPair {
    std::string a;
    std::string b;
    std::string topic;
    double score = 0.0;
};

struct QueueStats {
    std::size_t waiting = 0;
    std::size_t slots = 0;
    std::size_t token_buckets = 0;
    std::uint64_t oldest_wait_ms = 0;
};

// Case-insensitive FNV-1a. Interests are interned to 32-bit ids so scoring is
// integer compares instead of string compares.
inline std::uint32_t fnv1a(const std::string& s) {
    std::uint32_t h = 2166136261u;
    for (unsigned char c : s) {
        if (c >= 'A' && c <= 'Z') c = static_cast<unsigned char>(c - 'A' + 'a');
        h ^= c;
        h *= 16777619u;
    }
    return h;
}

class MatchQueue {
public:
    explicit MatchQueue(MatchWeights w = MatchWeights{},
                        std::string general_topic = "General Peer Discovery")
        : w_(w), general_topic_h_(fnv1a(normalize(general_topic, NormMode::Spaced).text)) {}

    // Try to pair immediately; otherwise join the queue. Re-joining with the
    // same session id refreshes the profile but KEEPS the original wait time,
    // so a client that reconnects does not lose its place.
    MatchResult enqueue(const Candidate& c) {
        std::lock_guard<std::mutex> g(m_);
        const std::uint64_t now = steady_now_ms();

        std::uint64_t since = now;
        auto existing = by_session_.find(c.session_id);
        if (existing != by_session_.end()) {
            since = slots_[existing->second].enqueued_ms;
            detach(existing->second);
        }

        Entry e = make_entry(c, since);
        const std::int64_t best = best_partner(e, now, /*skip_slot=*/-1);

        if (best >= 0) {
            Entry& peer = slots_[static_cast<std::size_t>(best)];
            MatchResult r;
            r.matched = true;
            r.peer_session_id = peer.c.session_id;
            r.topic = choose_topic(e, peer);
            r.score = last_best_score_;
            r.peer_wait_ms = now - peer.enqueued_ms;
            r.self_wait_ms = now - e.enqueued_ms;
            detach(static_cast<std::uint32_t>(best));
            return r;
        }

        attach(std::move(e));
        return MatchResult{};
    }

    bool remove(const std::string& session_id) {
        std::lock_guard<std::mutex> g(m_);
        auto it = by_session_.find(session_id);
        if (it == by_session_.end()) return false;
        detach(it->second);
        return true;
    }

    bool contains(const std::string& session_id) const {
        std::lock_guard<std::mutex> g(m_);
        return by_session_.count(session_id) != 0;
    }

    // 1-based position by wait time, or 0 if not queued. O(n) - call it for a
    // UI refresh, not on every frame.
    std::size_t position(const std::string& session_id) const {
        std::lock_guard<std::mutex> g(m_);
        auto it = by_session_.find(session_id);
        if (it == by_session_.end()) return 0;
        const std::uint64_t mine = slots_[it->second].enqueued_ms;
        std::size_t ahead = 0;
        for (const Entry& e : slots_) {
            if (e.active && e.enqueued_ms < mine) ++ahead;
        }
        return ahead + 1;
    }

    std::uint64_t wait_ms(const std::string& session_id) const {
        std::lock_guard<std::mutex> g(m_);
        auto it = by_session_.find(session_id);
        if (it == by_session_.end()) return 0;
        return steady_now_ms() - slots_[it->second].enqueued_ms;
    }

    // Periodic batch sweep. Oldest-first so the longest waiters get first pick.
    std::vector<MatchPair> drain(std::size_t max_pairs) {
        std::lock_guard<std::mutex> g(m_);
        const std::uint64_t now = steady_now_ms();

        std::vector<std::uint32_t> order;
        order.reserve(by_session_.size());
        for (std::uint32_t i = 0; i < slots_.size(); ++i) {
            if (slots_[i].active) order.push_back(i);
        }
        std::sort(order.begin(), order.end(), [&](std::uint32_t x, std::uint32_t y) {
            return slots_[x].enqueued_ms < slots_[y].enqueued_ms;
        });

        std::vector<MatchPair> pairs;
        for (std::uint32_t idx : order) {
            if (pairs.size() >= max_pairs) break;
            if (!slots_[idx].active) continue;  // already paired off this sweep

            Entry probe = slots_[idx];          // copy: best_partner skips by slot
            const std::int64_t best = best_partner(probe, now, static_cast<std::int64_t>(idx));
            if (best < 0) continue;

            MatchPair p;
            p.a = slots_[idx].c.session_id;
            p.b = slots_[static_cast<std::size_t>(best)].c.session_id;
            p.topic = choose_topic(slots_[idx], slots_[static_cast<std::size_t>(best)]);
            p.score = last_best_score_;
            detach(static_cast<std::uint32_t>(best));
            detach(idx);
            pairs.push_back(std::move(p));
        }
        return pairs;
    }

    // Evict anyone waiting longer than max_age_ms (dead tab, closed socket).
    std::vector<std::string> expire(std::uint64_t max_age_ms) {
        std::lock_guard<std::mutex> g(m_);
        const std::uint64_t now = steady_now_ms();
        std::vector<std::string> gone;
        for (std::uint32_t i = 0; i < slots_.size(); ++i) {
            if (!slots_[i].active) continue;
            if (now - slots_[i].enqueued_ms < max_age_ms) continue;
            gone.push_back(slots_[i].c.session_id);
            detach(i);
        }
        return gone;
    }

    std::size_t size() const {
        std::lock_guard<std::mutex> g(m_);
        return by_session_.size();
    }

    QueueStats stats() const {
        std::lock_guard<std::mutex> g(m_);
        const std::uint64_t now = steady_now_ms();
        QueueStats s;
        s.waiting = by_session_.size();
        s.slots = slots_.size();
        s.token_buckets = by_token_.size();
        for (const Entry& e : slots_) {
            if (!e.active) continue;
            s.oldest_wait_ms = std::max(s.oldest_wait_ms, now - e.enqueued_ms);
        }
        return s;
    }

    void clear() {
        std::lock_guard<std::mutex> g(m_);
        slots_.clear();
        free_.clear();
        by_session_.clear();
        by_token_.clear();
        by_discipline_.clear();
        general_.clear();
        stamp_.clear();
    }

private:
    struct Entry {
        Candidate c;
        std::vector<std::uint32_t> exact;   // hashed whole interest strings
        std::vector<std::uint32_t> words;   // hashed significant words
        std::uint32_t topic_h = 0;
        std::uint32_t campus_h = 0;
        std::uint32_t discipline_h = 0;
        std::uint64_t enqueued_ms = 0;
        std::uint32_t gen = 0;
        bool active = false;
    };

    struct Ref {
        std::uint32_t slot = 0;
        std::uint32_t gen = 0;
    };

    static bool is_stop_word(const std::string& t) {
        static const char* kStop[] = {"and", "the", "for", "with", "our", "your",
                                      "from", "into", "about", "general", "peer",
                                      "discovery", "other", "stuff", "things"};
        for (const char* s : kStop) {
            if (t == s) return true;
        }
        return false;
    }

    Entry make_entry(const Candidate& c, std::uint64_t since) const {
        Entry e;
        e.c = c;
        e.enqueued_ms = since;
        e.topic_h = fnv1a(normalize(c.topic, NormMode::Spaced).text);
        e.campus_h = fnv1a(normalize(c.campus, NormMode::Spaced).text);
        e.discipline_h = fnv1a(normalize(c.discipline, NormMode::Spaced).text);

        for (const std::string& raw : c.interests) {
            const std::string norm = normalize(raw, NormMode::Spaced).text;
            if (norm.empty()) continue;
            e.exact.push_back(fnv1a(norm));
            // Same tokenisation rule as runtime.ts sharedInterest(): split on
            // whitespace, drop stop words and 1-2 letter fragments.
            std::size_t i = 0;
            while (i < norm.size()) {
                std::size_t j = norm.find(' ', i);
                if (j == std::string::npos) j = norm.size();
                const std::string tok = norm.substr(i, j - i);
                if (tok.size() >= 3 && !is_stop_word(tok)) e.words.push_back(fnv1a(tok));
                i = j + 1;
            }
        }
        dedupe(e.exact);
        dedupe(e.words);
        return e;
    }

    static void dedupe(std::vector<std::uint32_t>& v) {
        std::sort(v.begin(), v.end());
        v.erase(std::unique(v.begin(), v.end()), v.end());
    }

    static std::size_t shared(const std::vector<std::uint32_t>& x,
                              const std::vector<std::uint32_t>& y) {
        std::size_t n = 0, i = 0, j = 0;
        while (i < x.size() && j < y.size()) {
            if (x[i] < y[j]) ++i;
            else if (y[j] < x[i]) ++j;
            else { ++n; ++i; ++j; }
        }
        return n;
    }

    bool valid(const Ref& r) const {
        return r.slot < slots_.size() && slots_[r.slot].gen == r.gen && slots_[r.slot].active;
    }

    // Score `other` as a partner for `me`. Negative means incompatible.
    double score(const Entry& me, const Entry& other, std::uint64_t now) const {
        if (me.c.verified != other.c.verified) return -1.0;  // hard pool split

        double s = 0.0;
        bool affinity = false;

        if (me.topic_h == other.topic_h && me.topic_h != general_topic_h_) {
            s += w_.topic_exact;
            affinity = true;
        }

        const double interest =
            static_cast<double>(shared(me.exact, other.exact)) * w_.interest_exact +
            static_cast<double>(shared(me.words, other.words)) * w_.interest_word;
        if (interest > 0.0) {
            s += std::min(interest, w_.interest_cap);
            affinity = true;
        }

        if (me.discipline_h == other.discipline_h) {
            s += w_.same_discipline;
            affinity = true;
        }
        if (me.campus_h == other.campus_h) s += w_.same_campus;

        if (me.c.year > 0 && other.c.year > 0) {
            const double delta = std::abs(static_cast<double>(me.c.year - other.c.year));
            s += std::max(0.0, w_.year_same - w_.year_step_penalty * delta);
        }

        // Nothing in common: allowed only if BOTH opted into the general pool,
        // and only after one of them has held out for general_hold_ms. Without
        // that window a fresh joiner grabs the first warm body in the queue and
        // the better match that arrives 200ms later is wasted.
        if (!affinity) {
            if (!(me.c.allow_general && other.c.allow_general)) return -1.0;
            const std::uint64_t waited =
                std::max(now - me.enqueued_ms, now - other.enqueued_ms);
            if (waited < w_.general_hold_ms) return -1.0;
        }

        // Anti-starvation: the longer `other` has waited, the better they look.
        s += w_.aging_per_sec * (static_cast<double>(now - other.enqueued_ms) / 1000.0);
        return s;
    }

    // Collect candidate slots from the inverted indexes, compacting dead refs
    // as it goes. `stamp_` dedupes without clearing a set every call.
    void gather(const Entry& me, std::int64_t skip_slot, std::vector<std::uint32_t>& out) {
        stamp_.resize(slots_.size(), 0);
        if (++stamp_cur_ == 0) {
            std::fill(stamp_.begin(), stamp_.end(), 0);
            stamp_cur_ = 1;
        }

        // Walking an index list does two jobs: collect candidates, and compact
        // out refs whose slot has since been reused. The general pool can get
        // long, so the walk is budgeted:
        //
        //   * clean list  -> stop after `budget` entries. O(max_scan).
        //   * dirty list  -> run to the end, because we are reclaiming dead
        //                    refs and the cost is paid back over their lifetime.
        //
        // The early exit is only taken while w == r, i.e. nothing has shifted,
        // so the untouched tail is already in its correct place.
        //
        // This is O(list length) in the worst case, which is fine up to queues
        // in the low thousands (see tests/bench.py). Beyond that, switch the
        // index to O(1) swap-removal with back-references into the entry.
        const std::size_t budget = static_cast<std::size_t>(w_.max_scan) * 4;
        auto take = [&](std::vector<Ref>& list) {
            std::size_t w = 0;
            std::size_t r = 0;
            for (; r < list.size(); ++r) {
                const Ref ref = list[r];
                if (!valid(ref)) continue;             // dead ref: drop it
                if (r >= budget && w == r) return;     // clean so far; leave the tail
                list[w++] = ref;
                if (out.size() >= w_.max_scan) continue;  // keep compacting, stop collecting
                if (ref.slot == static_cast<std::uint32_t>(skip_slot)) continue;
                if (stamp_[ref.slot] == stamp_cur_) continue;
                stamp_[ref.slot] = stamp_cur_;
                out.push_back(ref.slot);
            }
            list.resize(w);
        };

        for (std::uint32_t t : me.exact) {
            auto it = by_token_.find(t);
            if (it != by_token_.end()) take(it->second);
        }
        for (std::uint32_t t : me.words) {
            auto it = by_token_.find(t);
            if (it != by_token_.end()) take(it->second);
        }
        auto d = by_discipline_.find(me.discipline_h);
        if (d != by_discipline_.end()) take(d->second);
        if (me.c.allow_general) take(general_);
    }

    std::int64_t best_partner(const Entry& me, std::uint64_t now, std::int64_t skip_slot) {
        scratch_.clear();
        gather(me, skip_slot, scratch_);

        std::int64_t best = -1;
        double best_score = 0.0;
        for (std::uint32_t slot : scratch_) {
            const Entry& other = slots_[slot];
            if (!other.active) continue;
            if (other.c.session_id == me.c.session_id) continue;
            const double s = score(me, other, now);
            if (s < 0.0) continue;   // incompatible pool, or still holding out
            if (best < 0 || s > best_score) {
                best = static_cast<std::int64_t>(slot);
                best_score = s;
            }
        }
        last_best_score_ = best_score;
        return best;
    }

    std::string choose_topic(const Entry& a, const Entry& b) const {
        if (a.topic_h != general_topic_h_ && !a.c.topic.empty()) return a.c.topic;
        if (b.topic_h != general_topic_h_ && !b.c.topic.empty()) return b.c.topic;
        return a.c.topic.empty() ? b.c.topic : a.c.topic;
    }

    void attach(Entry&& e) {
        std::uint32_t idx;
        std::uint32_t gen;
        if (!free_.empty()) {
            idx = free_.back();
            free_.pop_back();
            gen = slots_[idx].gen;
        } else {
            idx = static_cast<std::uint32_t>(slots_.size());
            slots_.emplace_back();
            gen = 1;
        }
        slots_[idx] = std::move(e);
        slots_[idx].gen = gen;
        slots_[idx].active = true;
        stamp_.resize(slots_.size(), 0);

        const Ref ref{idx, gen};
        by_session_[slots_[idx].c.session_id] = idx;
        for (std::uint32_t t : slots_[idx].exact) by_token_[t].push_back(ref);
        for (std::uint32_t t : slots_[idx].words) by_token_[t].push_back(ref);
        by_discipline_[slots_[idx].discipline_h].push_back(ref);
        if (slots_[idx].c.allow_general) general_.push_back(ref);
    }

    // Index entries are left behind on purpose; bumping `gen` invalidates them
    // and gather() compacts them out on the next pass that touches the list.
    void detach(std::uint32_t idx) {
        if (idx >= slots_.size() || !slots_[idx].active) return;
        by_session_.erase(slots_[idx].c.session_id);
        slots_[idx].active = false;
        ++slots_[idx].gen;
        free_.push_back(idx);
    }

    MatchWeights w_;
    std::uint32_t general_topic_h_;

    std::vector<Entry> slots_;
    std::vector<std::uint32_t> free_;
    std::unordered_map<std::string, std::uint32_t> by_session_;
    std::unordered_map<std::uint32_t, std::vector<Ref>> by_token_;
    std::unordered_map<std::uint32_t, std::vector<Ref>> by_discipline_;
    std::vector<Ref> general_;

    std::vector<std::uint32_t> stamp_;
    std::uint32_t stamp_cur_ = 0;
    std::vector<std::uint32_t> scratch_;
    double last_best_score_ = 0.0;

    mutable std::mutex m_;
};

}  // namespace cm
