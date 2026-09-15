// bindings.cpp - pybind11 surface for coursemates_native.
//
// GIL policy: every method that can block on a std::mutex or do real work runs
// under py::call_guard<py::gil_scoped_release>. pybind11 converts arguments
// BEFORE the guard is constructed and converts the return value AFTER it is
// destroyed, so no Python object is ever touched while the GIL is dropped.
//
// That is the whole point of this module under FastAPI: the event loop thread
// can hand a message to the filter and keep serving other sockets.
//
// Nothing here holds a raw pointer to Python-owned memory, keeps a reference
// across a call, or indexes a container without bounds already proven by the
// surrounding logic. That discipline is the only crash isolation a pybind11
// extension gets - see native/README.md.

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <string>
#include <vector>

#include "content_filter.hpp"
#include "match_queue.hpp"
#include "rate_limiter.hpp"
#include "text_normalize.hpp"

namespace py = pybind11;
using namespace cm;

#ifndef CM_VERSION_INFO
#define CM_VERSION_INFO "0.0.0.dev"
#endif

PYBIND11_MODULE(coursemates_native, m) {
    m.doc() = "CourseMates native core: rate limiting, abuse scanning, matchmaking.";
    m.attr("__version__") = CM_VERSION_INFO;

    // ----------------------------------------------------------------- filter
    py::enum_<Action>(m, "Action")
        .value("ALLOW", kAllow)
        .value("FLAG", kFlag)
        .value("MASK", kMask)
        .value("BLOCK", kBlock)
        .export_values();

    py::class_<PatternSpec>(m, "PatternSpec")
        .def(py::init([](std::string phrase, std::string category, int severity,
                         bool whole_word, bool aggressive) {
                 return PatternSpec{std::move(phrase), std::move(category), severity,
                                    whole_word, aggressive};
             }),
             py::arg("phrase"), py::arg("category") = "generic", py::arg("severity") = 2,
             py::arg("whole_word") = true, py::arg("aggressive") = false)
        .def_readwrite("phrase", &PatternSpec::phrase)
        .def_readwrite("category", &PatternSpec::category)
        .def_readwrite("severity", &PatternSpec::severity)
        .def_readwrite("whole_word", &PatternSpec::whole_word)
        .def_readwrite("aggressive", &PatternSpec::aggressive)
        .def("__repr__", [](const PatternSpec& p) {
            return "<PatternSpec " + p.phrase + " sev=" + std::to_string(p.severity) + ">";
        });

    py::class_<Hit>(m, "Hit")
        .def_readonly("pattern_id", &Hit::pattern_id)
        .def_readonly("phrase", &Hit::phrase)
        .def_readonly("category", &Hit::category)
        .def_readonly("severity", &Hit::severity)
        .def_readonly("start", &Hit::start)
        .def_readonly("end", &Hit::end)
        .def("__repr__", [](const Hit& h) {
            return "<Hit " + h.category + ":" + h.phrase + " [" + std::to_string(h.start) +
                   "," + std::to_string(h.end) + ")>";
        });

    py::class_<Verdict>(m, "Verdict")
        .def_readonly("action", &Verdict::action)
        .def_readonly("max_severity", &Verdict::max_severity)
        .def_readonly("hits", &Verdict::hits)
        .def_property_readonly("allowed", [](const Verdict& v) { return v.action < kBlock; })
        .def_property_readonly("categories", [](const Verdict& v) {
            std::vector<std::string> out;
            for (const Hit& h : v.hits) {
                if (std::find(out.begin(), out.end(), h.category) == out.end()) {
                    out.push_back(h.category);
                }
            }
            return out;
        })
        .def("__repr__", [](const Verdict& v) {
            return "<Verdict action=" + std::to_string(v.action) + " hits=" +
                   std::to_string(v.hits.size()) + ">";
        });

    py::class_<ContentFilter>(m, "ContentFilter")
        .def(py::init<>())
        .def("load", &ContentFilter::load, py::arg("patterns"),
             py::call_guard<py::gil_scoped_release>(),
             "Rebuild the automaton. Atomic: in-flight scans keep the old one.")
        .def("scan", &ContentFilter::scan, py::arg("text"),
             py::call_guard<py::gil_scoped_release>())
        .def("redact", &ContentFilter::redact, py::arg("text"), py::arg("mask") = '*',
             py::call_guard<py::gil_scoped_release>())
        .def_property_readonly("pattern_count", &ContentFilter::pattern_count)
        .def_property_readonly("node_count", &ContentFilter::node_count);

    // ------------------------------------------------------------ rate limits
    py::class_<RateConfig>(m, "RateConfig")
        .def(py::init([](double capacity, double refill_per_sec, std::uint32_t strikes_to_block,
                         std::uint64_t base_block_ms, std::uint64_t max_block_ms,
                         std::uint64_t strike_decay_ms) {
                 return RateConfig{capacity, refill_per_sec, strikes_to_block,
                                   base_block_ms, max_block_ms, strike_decay_ms};
             }),
             py::arg("capacity") = 12.0, py::arg("refill_per_sec") = 4.0,
             py::arg("strikes_to_block") = 5u, py::arg("base_block_ms") = 2000ull,
             py::arg("max_block_ms") = 300000ull, py::arg("strike_decay_ms") = 60000ull)
        .def_readwrite("capacity", &RateConfig::capacity)
        .def_readwrite("refill_per_sec", &RateConfig::refill_per_sec)
        .def_readwrite("strikes_to_block", &RateConfig::strikes_to_block)
        .def_readwrite("base_block_ms", &RateConfig::base_block_ms)
        .def_readwrite("max_block_ms", &RateConfig::max_block_ms)
        .def_readwrite("strike_decay_ms", &RateConfig::strike_decay_ms);

    py::class_<RateDecision>(m, "RateDecision")
        .def_readonly("allowed", &RateDecision::allowed)
        .def_readonly("blocked", &RateDecision::blocked)
        .def_readonly("tokens_left", &RateDecision::tokens_left)
        .def_readonly("retry_after_ms", &RateDecision::retry_after_ms)
        .def_readonly("strikes", &RateDecision::strikes)
        .def("__bool__", [](const RateDecision& d) { return d.allowed; })
        .def("__repr__", [](const RateDecision& d) {
            return std::string("<RateDecision ") + (d.allowed ? "allow" : "deny") +
                   " retry_after_ms=" + std::to_string(d.retry_after_ms) + ">";
        });

    py::class_<RateLimiter>(m, "RateLimiter")
        .def(py::init<RateConfig, std::size_t>(), py::arg("config") = RateConfig{},
             py::arg("shards") = 64)
        .def("allow", &RateLimiter::allow, py::arg("key"), py::arg("cost") = 1.0,
             py::call_guard<py::gil_scoped_release>())
        .def("peek", &RateLimiter::peek, py::arg("key"),
             py::call_guard<py::gil_scoped_release>())
        .def("reset", &RateLimiter::reset, py::arg("key"),
             py::call_guard<py::gil_scoped_release>())
        .def("gc", &RateLimiter::gc, py::arg("idle_ms") = 600000ull,
             py::call_guard<py::gil_scoped_release>(),
             "Drop idle buckets. Call from the periodic sweep or the map leaks.")
        .def("__len__", &RateLimiter::size, py::call_guard<py::gil_scoped_release>())
        .def_property_readonly("size", &RateLimiter::size);

    // ----------------------------------------------------------- matchmaking
    py::class_<Candidate>(m, "Candidate")
        .def(py::init([](std::string session_id, bool verified, std::string campus,
                         std::string discipline, std::int32_t year, std::string topic,
                         std::vector<std::string> interests, bool allow_general) {
                 return Candidate{std::move(session_id), verified,  std::move(campus),
                                  std::move(discipline), year,      std::move(topic),
                                  std::move(interests),  allow_general};
             }),
             py::arg("session_id"), py::arg("verified") = false, py::arg("campus") = "",
             py::arg("discipline") = "", py::arg("year") = 0, py::arg("topic") = "",
             py::arg("interests") = std::vector<std::string>{}, py::arg("allow_general") = true)
        .def_readwrite("session_id", &Candidate::session_id)
        .def_readwrite("verified", &Candidate::verified)
        .def_readwrite("campus", &Candidate::campus)
        .def_readwrite("discipline", &Candidate::discipline)
        .def_readwrite("year", &Candidate::year)
        .def_readwrite("topic", &Candidate::topic)
        .def_readwrite("interests", &Candidate::interests)
        .def_readwrite("allow_general", &Candidate::allow_general);

    py::class_<MatchWeights>(m, "MatchWeights")
        .def(py::init<>())
        .def_readwrite("topic_exact", &MatchWeights::topic_exact)
        .def_readwrite("interest_exact", &MatchWeights::interest_exact)
        .def_readwrite("interest_word", &MatchWeights::interest_word)
        .def_readwrite("interest_cap", &MatchWeights::interest_cap)
        .def_readwrite("same_discipline", &MatchWeights::same_discipline)
        .def_readwrite("same_campus", &MatchWeights::same_campus)
        .def_readwrite("year_same", &MatchWeights::year_same)
        .def_readwrite("year_step_penalty", &MatchWeights::year_step_penalty)
        .def_readwrite("aging_per_sec", &MatchWeights::aging_per_sec)
        .def_readwrite("general_hold_ms", &MatchWeights::general_hold_ms)
        .def_readwrite("max_scan", &MatchWeights::max_scan);

    py::class_<MatchResult>(m, "MatchResult")
        .def_readonly("matched", &MatchResult::matched)
        .def_readonly("peer_session_id", &MatchResult::peer_session_id)
        .def_readonly("topic", &MatchResult::topic)
        .def_readonly("score", &MatchResult::score)
        .def_readonly("peer_wait_ms", &MatchResult::peer_wait_ms)
        .def_readonly("self_wait_ms", &MatchResult::self_wait_ms)
        .def("__bool__", [](const MatchResult& r) { return r.matched; })
        .def("__repr__", [](const MatchResult& r) {
            return r.matched ? "<MatchResult peer=" + r.peer_session_id + " score=" +
                                   std::to_string(r.score) + ">"
                             : std::string("<MatchResult queued>");
        });

    py::class_<MatchPair>(m, "MatchPair")
        .def_readonly("a", &MatchPair::a)
        .def_readonly("b", &MatchPair::b)
        .def_readonly("topic", &MatchPair::topic)
        .def_readonly("score", &MatchPair::score);

    py::class_<QueueStats>(m, "QueueStats")
        .def_readonly("waiting", &QueueStats::waiting)
        .def_readonly("slots", &QueueStats::slots)
        .def_readonly("token_buckets", &QueueStats::token_buckets)
        .def_readonly("oldest_wait_ms", &QueueStats::oldest_wait_ms);

    py::class_<MatchQueue>(m, "MatchQueue")
        .def(py::init<MatchWeights, std::string>(), py::arg("weights") = MatchWeights{},
             py::arg("general_topic") = "General Peer Discovery")
        .def("enqueue", &MatchQueue::enqueue, py::arg("candidate"),
             py::call_guard<py::gil_scoped_release>(),
             "Pair immediately if a good partner is waiting, else join the queue.")
        .def("remove", &MatchQueue::remove, py::arg("session_id"),
             py::call_guard<py::gil_scoped_release>())
        .def("contains", &MatchQueue::contains, py::arg("session_id"),
             py::call_guard<py::gil_scoped_release>())
        .def("position", &MatchQueue::position, py::arg("session_id"),
             py::call_guard<py::gil_scoped_release>())
        .def("wait_ms", &MatchQueue::wait_ms, py::arg("session_id"),
             py::call_guard<py::gil_scoped_release>())
        .def("drain", &MatchQueue::drain, py::arg("max_pairs") = 256,
             py::call_guard<py::gil_scoped_release>(),
             "Batch sweep, oldest first. Recovers most of the quality a global "
             "matcher would give, without its O(n^3) cost.")
        .def("expire", &MatchQueue::expire, py::arg("max_age_ms"),
             py::call_guard<py::gil_scoped_release>())
        .def("clear", &MatchQueue::clear, py::call_guard<py::gil_scoped_release>())
        .def("stats", &MatchQueue::stats, py::call_guard<py::gil_scoped_release>())
        .def("__len__", &MatchQueue::size, py::call_guard<py::gil_scoped_release>())
        .def_property_readonly("size", &MatchQueue::size);

    // ------------------------------------------------------------------ utils
    m.def(
        "normalize_text",
        [](const std::string& text, bool squashed) {
            return normalize(text, squashed ? NormMode::Squashed : NormMode::Spaced).text;
        },
        py::arg("text"), py::arg("squashed") = false,
        py::call_guard<py::gil_scoped_release>(),
        "Expose the folding the filter uses, for tuning pattern lists in tests.");

    m.def("steady_now_ms", &steady_now_ms, py::call_guard<py::gil_scoped_release>());
}
