// content_filter.hpp - Aho-Corasick abuse/spam scanner.
//
// One automaton, two passes (spaced buffer + squashed buffer), O(len) per
// message regardless of how many patterns are loaded. A few hundred patterns
// costs the same as one.
//
// Zero-log: scan() never copies or stores the message. Hits carry pattern ids
// and byte offsets only - enough to mask or drop client-side, nothing that can
// reconstruct a conversation from a heap dump.

#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <utility>
#include <vector>

#include "text_normalize.hpp"

namespace cm {

struct PatternSpec {
    std::string phrase;
    std::string category = "generic";
    int severity = 2;           // 1 = flag, 2 = mask, 3 = block
    bool whole_word = true;     // require word boundaries in the spaced buffer
    bool aggressive = false;    // also match the de-obfuscated squashed buffer
};

struct Hit {
    std::uint32_t pattern_id = 0;
    std::string phrase;
    std::string category;
    int severity = 0;
    std::uint32_t start = 0;    // byte offset into the ORIGINAL message
    std::uint32_t end = 0;
};

enum Action { kAllow = 0, kFlag = 1, kMask = 2, kBlock = 3 };

struct Verdict {
    int action = kAllow;
    int max_severity = 0;
    std::vector<Hit> hits;
};

// ---------------------------------------------------------------------------
// Aho-Corasick, compiled down to a full DFA so matching never follows a fail
// link at scan time.
// ---------------------------------------------------------------------------
class Automaton {
public:
    static constexpr int kAlpha = 37;  // a-z, 0-9, space

    static int index_of(char c) {
        if (c >= 'a' && c <= 'z') return c - 'a';
        if (c >= '0' && c <= '9') return 26 + (c - '0');
        if (c == ' ') return 36;
        return -1;
    }

    Automaton() { nodes_.emplace_back(); }

    void insert(const std::string& s, std::uint32_t id) {
        if (s.empty()) return;
        std::int32_t cur = 0;
        for (char c : s) {
            const int a = index_of(c);
            if (a < 0) return;  // unreachable post-normalisation; fail closed
            if (nodes_[cur].go[a] < 0) {
                const std::uint32_t depth = nodes_[cur].depth + 1;
                nodes_.emplace_back();
                nodes_.back().depth = depth;
                nodes_[cur].go[a] = static_cast<std::int32_t>(nodes_.size() - 1);
            }
            cur = nodes_[cur].go[a];
        }
        auto& o = nodes_[cur].out;
        if (std::find(o.begin(), o.end(), id) == o.end()) o.push_back(id);
    }

    void build() {
        std::queue<std::int32_t> q;
        for (int a = 0; a < kAlpha; ++a) {
            const std::int32_t t = nodes_[0].go[a];
            if (t < 0) {
                nodes_[0].go[a] = 0;
            } else {
                nodes_[t].fail = 0;
                q.push(t);
            }
        }
        while (!q.empty()) {
            const std::int32_t u = q.front();
            q.pop();
            const std::int32_t f = nodes_[u].fail;
            nodes_[u].out_link = nodes_[f].out.empty() ? nodes_[f].out_link : f;
            for (int a = 0; a < kAlpha; ++a) {
                const std::int32_t v = nodes_[u].go[a];
                if (v < 0) {
                    nodes_[u].go[a] = nodes_[f].go[a];
                } else {
                    nodes_[v].fail = nodes_[f].go[a];
                    q.push(v);
                }
            }
        }
    }

    // on_hit(pattern_id, end_index_inclusive, pattern_length)
    template <typename Fn>
    void scan(const std::string& buf, Fn&& on_hit) const {
        std::int32_t cur = 0;
        for (std::size_t i = 0; i < buf.size(); ++i) {
            const int a = index_of(buf[i]);
            if (a < 0) { cur = 0; continue; }
            cur = nodes_[cur].go[a];
            for (std::int32_t n = nodes_[cur].out.empty() ? nodes_[cur].out_link : cur;
                 n >= 0; n = nodes_[n].out_link) {
                for (std::uint32_t id : nodes_[n].out) on_hit(id, i, nodes_[n].depth);
            }
        }
    }

    std::size_t node_count() const { return nodes_.size(); }

private:
    struct Node {
        std::array<std::int32_t, kAlpha> go;
        std::int32_t fail = 0;
        std::int32_t out_link = -1;
        std::uint32_t depth = 0;
        std::vector<std::uint32_t> out;
        Node() { go.fill(-1); }
    };
    std::vector<Node> nodes_;
};

// ---------------------------------------------------------------------------
// ContentFilter
//
// Thread safety: the compiled automaton is immutable. load() builds a fresh one
// off to the side and swaps a shared_ptr under a tiny mutex, so scanners never
// block on a reload and a reload never invalidates an in-flight scan.
// ---------------------------------------------------------------------------
class ContentFilter {
public:
    ContentFilter() : impl_(std::make_shared<Impl>()) {}

    void load(const std::vector<PatternSpec>& specs) {
        auto impl = std::make_shared<Impl>();
        impl->specs = specs;
        for (std::uint32_t id = 0; id < specs.size(); ++id) {
            const std::string spaced = normalize(specs[id].phrase, NormMode::Spaced).text;
            if (!spaced.empty()) impl->ac.insert(spaced, id);
            if (specs[id].aggressive) {
                impl->any_aggressive = true;
                const std::string squashed = normalize(specs[id].phrase, NormMode::Squashed).text;
                if (!squashed.empty()) impl->ac.insert(squashed, id);
            }
        }
        impl->ac.build();
        std::lock_guard<std::mutex> g(swap_);
        impl_ = impl;
    }

    Verdict scan(const std::string& text) const {
        const std::shared_ptr<const Impl> impl = snapshot();
        Verdict v;
        if (impl->specs.empty() || text.empty()) return v;

        std::vector<std::uint64_t> seen;
        auto record = [&](std::uint32_t id, std::uint32_t s, std::uint32_t e) {
            const std::uint64_t key = (static_cast<std::uint64_t>(id) << 32) | s;
            if (std::find(seen.begin(), seen.end(), key) != seen.end()) return;
            seen.push_back(key);
            const PatternSpec& sp = impl->specs[id];
            v.hits.push_back(Hit{id, sp.phrase, sp.category, sp.severity, s, e});
            if (sp.severity > v.max_severity) v.max_severity = sp.severity;
        };

        // Pass 1: word-boundary aware. "classic" does not trip "ass".
        const Normalized spaced = normalize(text, NormMode::Spaced);
        impl->ac.scan(spaced.text, [&](std::uint32_t id, std::size_t end_i, std::uint32_t len) {
            const std::size_t start_i = end_i + 1 - len;
            if (impl->specs[id].whole_word) {
                const bool left = (start_i == 0) || spaced.text[start_i - 1] == ' ';
                const bool right = (end_i + 1 == spaced.text.size()) || spaced.text[end_i + 1] == ' ';
                if (!left || !right) return;
            }
            record(id, spaced.src[start_i], spaced.src_end[end_i]);
        });

        // Pass 2: de-obfuscated. Opt-in per pattern because it is lossy.
        if (impl->any_aggressive) {
            const Normalized squashed = normalize(text, NormMode::Squashed);
            impl->ac.scan(squashed.text, [&](std::uint32_t id, std::size_t end_i, std::uint32_t len) {
                if (!impl->specs[id].aggressive) return;
                const std::size_t start_i = end_i + 1 - len;
                record(id, squashed.src[start_i], squashed.src_end[end_i]);
            });
        }

        v.action = v.max_severity;
        return v;
    }

    // Returns the message with every mask/block span replaced by `mask`.
    std::string redact(const std::string& text, char mask = '*') const {
        const Verdict v = scan(text);
        if (v.hits.empty()) return text;

        std::vector<std::pair<std::uint32_t, std::uint32_t>> spans;
        spans.reserve(v.hits.size());
        for (const Hit& h : v.hits) {
            if (h.severity >= kMask) spans.emplace_back(h.start, h.end);
        }
        if (spans.empty()) return text;
        std::sort(spans.begin(), spans.end());

        std::string out;
        out.reserve(text.size());
        std::size_t i = 0;
        std::size_t k = 0;
        while (i < text.size()) {
            while (k < spans.size() && spans[k].second <= i) ++k;
            if (k < spans.size() && i >= spans[k].first) {
                std::uint32_t stop = spans[k].second;
                while (k + 1 < spans.size() && spans[k + 1].first <= stop) {
                    ++k;
                    stop = std::max(stop, spans[k].second);
                }
                while (i < stop && i < text.size()) {
                    utf8_next(text, i);  // one mask char per codepoint, not per byte
                    out.push_back(mask);
                }
                ++k;
            } else {
                out.push_back(text[i++]);
            }
        }
        return out;
    }

    std::size_t pattern_count() const { return snapshot()->specs.size(); }
    std::size_t node_count() const { return snapshot()->ac.node_count(); }

private:
    struct Impl {
        std::vector<PatternSpec> specs;
        Automaton ac;
        bool any_aggressive = false;
    };

    std::shared_ptr<const Impl> snapshot() const {
        std::lock_guard<std::mutex> g(swap_);
        return impl_;
    }

    std::shared_ptr<const Impl> impl_;
    mutable std::mutex swap_;
};

}  // namespace cm
