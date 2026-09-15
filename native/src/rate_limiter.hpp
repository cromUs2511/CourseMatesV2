// rate_limiter.hpp - sharded token bucket with an escalating penalty box.
//
// One bucket per key (session id, IP, or "ip:route"). Buckets are lazily
// refilled, so there is no background timer and no per-key thread.
//
// Sharding: 64 independent mutex + map pairs keyed by hash(key). Under
// concurrent WebSocket traffic, contention is ~1/64 of a single global lock,
// which is what lets the caller hold this while the GIL is released.
//
// Monotonic clock only. A wall-clock jump (NTP step, DST, VM resume) must not
// hand out free tokens or brick a bucket for hours.

#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace cm {

inline std::uint64_t steady_now_ms() {
    using namespace std::chrono;
    return static_cast<std::uint64_t>(
        duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count());
}

struct RateDecision {
    bool allowed = true;
    bool blocked = false;           // currently serving a penalty-box sentence
    double tokens_left = 0.0;
    std::uint64_t retry_after_ms = 0;
    std::uint32_t strikes = 0;
};

struct RateConfig {
    double capacity = 12.0;             // burst size
    double refill_per_sec = 4.0;        // sustained rate
    std::uint32_t strikes_to_block = 5; // refusals before the penalty box opens
    std::uint64_t base_block_ms = 2000; // first sentence
    std::uint64_t max_block_ms = 300000;
    std::uint64_t strike_decay_ms = 60000;  // clean streak that clears strikes
};

class RateLimiter {
public:
    explicit RateLimiter(RateConfig cfg = RateConfig{}, std::size_t shards = 64)
        : cfg_(cfg), shards_(shards ? shards : 1) {
        buckets_.resize(shards_);
        locks_.resize(shards_);
        for (auto& m : locks_) m = std::make_unique<std::mutex>();
    }

    RateDecision allow(const std::string& key, double cost = 1.0) {
        const std::uint64_t now = steady_now_ms();
        const std::size_t s = shard(key);
        std::lock_guard<std::mutex> g(*locks_[s]);

        Bucket& b = touch(buckets_[s], key, now);
        b.last_seen_ms = now;

        if (b.blocked_until_ms > now) {
            return RateDecision{false, true, b.tokens, b.blocked_until_ms - now, b.strikes};
        }

        // Lazy refill.
        const double elapsed = static_cast<double>(now - b.last_ms) / 1000.0;
        b.tokens = std::min(cfg_.capacity, b.tokens + elapsed * cfg_.refill_per_sec);
        b.last_ms = now;

        // A clean streak forgives past strikes so one bad minute in a two-hour
        // session does not follow a student around.
        if (b.strikes > 0 && now - b.last_strike_ms > cfg_.strike_decay_ms) b.strikes = 0;

        if (b.tokens >= cost) {
            b.tokens -= cost;
            return RateDecision{true, false, b.tokens, 0, b.strikes};
        }

        ++b.strikes;
        b.last_strike_ms = now;
        std::uint64_t retry = static_cast<std::uint64_t>(
            std::ceil((cost - b.tokens) / std::max(1e-9, cfg_.refill_per_sec) * 1000.0));

        if (b.strikes >= cfg_.strikes_to_block) {
            // Exponential sentence, capped. Shifting by (strikes - threshold)
            // is clamped to 20 so the shift itself can never overflow.
            const std::uint32_t over = std::min<std::uint32_t>(b.strikes - cfg_.strikes_to_block, 20u);
            const std::uint64_t sentence =
                std::min(cfg_.max_block_ms, cfg_.base_block_ms << over);
            b.blocked_until_ms = now + sentence;
            retry = sentence;
            return RateDecision{false, true, b.tokens, retry, b.strikes};
        }
        return RateDecision{false, false, b.tokens, retry, b.strikes};
    }

    // Non-consuming check, for logging a "would this be throttled" metric.
    RateDecision peek(const std::string& key) {
        return allow(key, 0.0);
    }

    void reset(const std::string& key) {
        const std::size_t s = shard(key);
        std::lock_guard<std::mutex> g(*locks_[s]);
        buckets_[s].erase(key);
    }

    // Drop buckets untouched for `idle_ms`. Anonymous chat churns through
    // session ids fast; without this the map is an unbounded leak.
    std::size_t gc(std::uint64_t idle_ms) {
        const std::uint64_t now = steady_now_ms();
        std::size_t dropped = 0;
        for (std::size_t s = 0; s < shards_; ++s) {
            std::lock_guard<std::mutex> g(*locks_[s]);
            auto& m = buckets_[s];
            for (auto it = m.begin(); it != m.end();) {
                const bool idle = now - it->second.last_seen_ms >= idle_ms;
                const bool serving = it->second.blocked_until_ms > now;
                if (idle && !serving) { it = m.erase(it); ++dropped; }
                else { ++it; }
            }
        }
        return dropped;
    }

    std::size_t size() const {
        std::size_t n = 0;
        for (std::size_t s = 0; s < shards_; ++s) {
            std::lock_guard<std::mutex> g(*locks_[s]);
            n += buckets_[s].size();
        }
        return n;
    }

    RateConfig config() const { return cfg_; }

private:
    struct Bucket {
        double tokens = 0.0;
        std::uint64_t last_ms = 0;
        std::uint64_t last_seen_ms = 0;
        std::uint64_t last_strike_ms = 0;
        std::uint64_t blocked_until_ms = 0;
        std::uint32_t strikes = 0;
    };

    using Map = std::unordered_map<std::string, Bucket>;

    std::size_t shard(const std::string& key) const {
        return std::hash<std::string>{}(key) % shards_;
    }

    Bucket& touch(Map& m, const std::string& key, std::uint64_t now) {
        auto it = m.find(key);
        if (it != m.end()) return it->second;
        Bucket b;
        b.tokens = cfg_.capacity;  // new keys start full
        b.last_ms = now;
        b.last_seen_ms = now;
        return m.emplace(key, b).first->second;
    }

    RateConfig cfg_;
    std::size_t shards_;
    std::vector<Map> buckets_;
    mutable std::vector<std::unique_ptr<std::mutex>> locks_;
};

}  // namespace cm
