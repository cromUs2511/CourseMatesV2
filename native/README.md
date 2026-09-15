# coursemates_native

The C++ core: abuse/spam scanning, rate limiting, and matchmaking, exposed to
Python through pybind11 as a single compiled module.

```
native/
  CMakeLists.txt          build definition
  pyproject.toml          pip-installable (scikit-build-core -> CMake -> wheel)
  src/
    text_normalize.hpp    Unicode folding / de-obfuscation
    content_filter.hpp    Aho-Corasick scanner
    rate_limiter.hpp      sharded token bucket + penalty box
    match_queue.hpp       priority-bucket matchmaking
    bindings.cpp          the pybind11 surface (the only .cpp)
  tests/
    smoke.cpp             compiler-only tests, no Python needed
    test_native.py        pytest suite across the pybind11 boundary
    bench.py              latency numbers for the three hot paths
```

Python code imports [`../native_bridge.py`](../native_bridge.py), never this
module directly. That gives one place to answer "is the fast path live?" and
one place for the pure-Python fallback.

---

## Build

Requires a C++17 compiler, CMake ≥ 3.18, and Python ≥ 3.10.

```bash
pip install ./native            # from the repo root
python -c "import coursemates_native as c; print(c.__version__)"
```

`pip install -e ./native` gives an editable build that recompiles on import
after a source change.

**Windows.** Use the MSVC toolchain: install "Desktop development with C++"
from the Visual Studio Build Tools. MinGW/MSYS2 *can* produce a working `.pyd`
against a CPython built with MSVC, but only if you statically link the GCC
runtime — otherwise the extension builds fine and then fails at import with
`DLL load failed while importing coursemates_native`, because `libstdc++-6.dll`
and `libwinpthread-1.dll` are not on the path. If you must use MinGW:

```bash
g++ -std=c++17 -O2 -shared -fvisibility=hidden \
    -I src -I "$(python -m pybind11 --includes)" \
    src/bindings.cpp -L "<pythondir>/libs" -lpython3XX \
    -static-libgcc -static-libstdc++ \
    -Wl,-Bstatic -lstdc++ -lpthread -Wl,-Bdynamic \
    -o coursemates_native.pyd
```

**macOS.** Xcode command line tools (`xcode-select --install`). Nothing special.

**Linux.** GCC ≥ 9 or Clang ≥ 10. For a wheel that runs on other machines,
build inside a `manylinux` container via `cibuildwheel` rather than shipping a
wheel built against your distro's glibc.

The build is one translation unit — everything else is header-only — so it
compiles in a couple of seconds and there is no link order to get wrong.

---

## Test

```bash
# 1. C++ logic. No Python, no pybind11, no CMake.
g++ -std=c++17 -O2 -Wall -Wextra -I src tests/smoke.cpp -o smoke && ./smoke

# 2. The pybind11 boundary: conversions, GIL release, thread safety.
pip install ./native[test] && pytest native/tests/test_native.py

# 3. Latency.
python native/tests/bench.py
```

Run `smoke.cpp` first when something breaks: it separates "my C++ is wrong"
from "my toolchain is wrong".

In CI, also build with `-DCM_SANITIZE=ON` and run the pytest suite under
AddressSanitizer + UBSan. That is what actually catches the class of bug that
would otherwise become a production segfault. Never ship a sanitized wheel.

---

## Measured latency

From `tests/bench.py` on Windows 11 / Python 3.14 / `g++ -O2`. Yours will
differ; the ratios are the point.

| Operation | Native | Python | Ratio |
|---|---|---|---|
| Filter, 30-word message, 309 patterns | **6.7 µs** | 31 µs (naive substring loop) | 5× |
| " | " | 16.4 ms (regex alternation) | ~2400× |
| Filter, 4 KB message | **119 µs** | — | — |
| Rate limiter, 10k keys | **1.5 µs** | 1.5 µs | **1.0×** |
| Matchmaking enqueue, shared interests | **7.9 µs** | — | — |
| Matchmaking enqueue, 40k queue, zero affinity | **20.6 µs** | — | — |

Read these honestly:

- **The filter is the real win.** String scanning is what CPython is worst at,
  and Aho-Corasick makes the cost flat in pattern count — 300 patterns cost the
  same as 3. Grow the list to 5,000 and the number barely moves.
- **The rate limiter is a wash.** A token bucket is ten dict operations; the
  ~1 µs pybind11 call overhead eats the entire win. It lives here for the
  GIL-free property and the compact memory layout, *not* for speed. Do not cite
  a speedup for it.
- **Matchmaking wins on algorithm, not on C++.** The inverted index plus capped
  scan is what makes it flat; the same structure in Python would also beat a
  linear scan. C++ buys maybe another 5–10×.

If you need one sentence for a project report: *the filter justified the
native module; the other two came along because they were already there.*

---

## Why pybind11 and not a gRPC or Redis sidecar

| | pybind11 in-process | C++ sidecar (gRPC / Redis) |
|---|---|---|
| Call overhead | ~1 µs | ~150–400 µs gRPC loopback, ~100–200 µs Redis (published figures, not measured here) |
| Deploy artifacts | 1 process | 2+ processes, plus a supervisor |
| Shared state across replicas | no | **yes** |
| A C++ crash takes down | the whole server | one sidecar |
| Debugging | one stack trace | two logs and a correlation id |
| Ops burden | a compiler in CI | service discovery, health checks, retries, timeouts, backpressure |

**Recommendation: pybind11.** The deciding number is the first row. The work
being offloaded takes 1–20 µs; the cheapest possible network hop costs 100 µs+.
A sidecar would make every one of these operations *slower* while adding a
second thing that can be down at 2am. For a university-scale deployment on one
box, that trade is not close.

The sidecar becomes the right answer at exactly one point: **when you need more
than one server process.** Today `runtime.ts` (and `app_realtime.py`) keeps the
queue, rooms and sessions in local memory, so a second replica would match
students against a queue the first replica cannot see. If you ever scale out,
the C++ matchmaker moving to its own process is the natural fix — not because
C++ needs isolating, but because *the queue does*. Until then it is a solution
looking for a problem.

On memory-leak risk specifically: the sidecar argument is weaker than it looks.
Every allocation in this module is owned by a `std::vector`, `std::string`,
`std::unordered_map` or `shared_ptr` — there is not a single `new`, `delete`,
`malloc` or raw owning pointer in `src/`. The leak you actually have to worry
about is the *logical* one: unbounded growth of the rate-limiter map and the
match queue as anonymous sessions churn. Both have explicit reclamation
(`gc()`, `expire()`) and the sweep loop in `app_realtime.py` calls them. A
sidecar would not have saved you from forgetting that; it would just have
leaked in a different process.

---

## Thread safety and the GIL

**Every method that can block or do real work releases the GIL** via
`py::call_guard<py::gil_scoped_release>()`. pybind11 converts arguments *before*
constructing the guard and converts the return value *after* destroying it, so
no Python object is touched while the GIL is dropped. This is what lets the
FastAPI event loop hand a 4 KB message to the filter and keep serving other
sockets in the meantime.

`test_native.py::test_filter_releases_the_gil` asserts this directly: two
threads scanning must finish in well under 2× the single-threaded time. If
someone removes a `call_guard` in a refactor, that test fails.

Locking, by component:

- **`RateLimiter`** — 64 independent shards, each its own `std::mutex` +
  `unordered_map`, chosen by `hash(key) % 64`. Two sessions almost never touch
  the same lock. `size()` and `gc()` walk all shards and take each lock in turn.
- **`ContentFilter`** — the compiled automaton is **immutable**. `load()` builds
  a new one off to the side and swaps a `shared_ptr` under a tiny mutex held
  only for the pointer copy. Scanning takes a snapshot and then runs completely
  lock-free, so a pattern reload cannot stall or corrupt an in-flight scan. You
  can hot-reload the word list under load.
- **`MatchQueue`** — one `std::mutex` for the whole structure. Operations are
  ~10 µs and the invariants span several containers at once (slot table, session
  map, three inverted indexes), so finer-grained locking would buy microseconds
  and cost correctness. If it ever becomes the bottleneck, shard by
  `(verified, campus)` — those pools never match across each other anyway.

`steady_clock` is used everywhere, never wall clock. An NTP step or a VM resume
must not hand out free tokens or freeze a bucket for hours.

---

## Crash isolation: the honest answer

**A segfault in this module kills the Python process. pybind11 offers no
protection and cannot.** The extension runs in the interpreter's address space;
there is no boundary to contain a bad write. `try/except` will not catch it,
and neither will FastAPI's exception handlers.

What actually reduces the risk, in order of value:

1. **Own nothing manually.** No `new`/`delete`, no raw owning pointers, no
   `reinterpret_cast` of caller data, no unchecked indexing. Bounds are proven
   by surrounding logic in every loop in `src/`. This is the whole defence.
2. **Fuzz the parser.** `text_normalize.hpp` is the only code that walks
   attacker-controlled bytes. Its UTF-8 decoder consumes malformed input one
   byte at a time and returns U+FFFD rather than over-reading (`smoke.cpp`
   covers truncated sequences). Point libFuzzer at `normalize()` before you
   trust it with the open internet.
3. **Build with the guards on.** Release builds already set
   `-D_GLIBCXX_ASSERTIONS` and `-fstack-protector-strong`, which turn silent
   out-of-range `vector` access into a loud abort instead of corrupting another
   session's memory. Run CI with ASan/UBSan (`-DCM_SANITIZE=ON`).
4. **`faulthandler.enable()`** — set in `native_bridge.py`. Turns a silent exit
   code 139 / `0xC0000005` into a native stack trace on stderr. You cannot
   prevent the crash; you can refuse to debug it blind.
5. **`CM_DISABLE_NATIVE=1`** — forces the pure-Python path without a redeploy.
   If the native core is ever suspected during an incident, this is the
   rollback.
6. **Supervise the process.** `systemd` with `Restart=always`, or Docker with
   `restart: unless-stopped`.

Point 6 needs a caveat specific to this app: **restarting does not preserve
state.** Sessions, rooms and the queue are all in-memory, so a crash drops every
live conversation whether C++ was involved or not. Multiple uvicorn workers do
not help either — they would each hold a *different* queue. So "a segfault must
not take down the server" is not really achievable in the current architecture,
and the native module does not make it meaningfully worse. If that guarantee
matters more than latency, the answer is the sidecar from the section above,
with the queue moved out of process — and you should make that choice for the
state, not for the crash.

---

## Tuning

### Filter patterns

Patterns live in `DEFAULT_PATTERNS` in `native_bridge.py`.

- `severity` 1 = allow but count, 2 = mask the span, 3 = drop the message.
- `whole_word` (default on) requires word boundaries, so `"ass"` does not fire
  on `"classic assignment"`. Turn it off only for patterns that are never
  substrings of anything innocent.
- `aggressive` additionally scans a de-obfuscated buffer where separators and
  repeated letters are stripped, catching `k i l l  y o u r s e l f` and
  `fuuuuck`. It is deliberately lossy — `"pass"` and `"pas"` collapse together —
  so reserve it for phrases that are never innocent.

Check what the engine actually sees before adding a pattern:

```python
>>> import coursemates_native as cn
>>> cn.normalize_text("Ｆ.Ｕ.Ｃ.Ｋ")           # 'f u c k'
>>> cn.normalize_text("Ｆ.Ｕ.Ｃ.Ｋ", squashed=True)  # 'fuck'
```

The normaliser folds case, leetspeak (`0`→`o`, `3`→`e`, `@`→`a`, …), Latin-1
accents, Cyrillic and Greek homoglyphs, fullwidth forms, mathematical
alphanumerics (`𝓯𝓾𝓬𝓴`), and drops zero-width characters and combining marks
without breaking the word. It does **not** cover Latin Extended-A (`ł`, `ş`,
`ğ`) — those currently read as word separators.

### Matchmaking weights

```python
q = nb.build_match_queue(general_hold_ms=8000, same_discipline=200)
```

`general_hold_ms` is the important one. It is how long a student holds out for a
peer with *some* affinity — shared topic, shared interest, or same discipline —
before the queue will pair them with a stranger. Lower it for faster matching
and worse pairs; raise it for the opposite. `aging_per_sec` then keeps ranking
long waiters higher so nobody starves.

**Watch out for generic words in interest strings.** Interests are tokenised
into words, and a word shared by every student's interest list silently makes
everybody a match. A list like `"Interest 7"`, `"Interest 12"` gives every
single pair the shared token `interest` — this bit the benchmark before it was
caught. If your real vocabulary has a common word (`"Studies"`, `"General"`,
`"Course"`), add it to `is_stop_word()` in `match_queue.hpp`.

---

## Known limitations

- **Single process.** The queue lives in one `MatchQueue` instance in one
  process. Two replicas means two queues that cannot see each other.
- **Interests are hashed to 32 bits** (FNV-1a). A collision would make two
  unrelated interests look identical. At a few thousand distinct interests the
  probability is negligible, but it is not zero.
- **`position()` is O(n).** Call it on a UI refresh, not per frame.
- **The Python fallback is not equivalent.** It is ~2400× slower on the filter
  and its de-obfuscation is weaker (no homoglyph table, no offset tracking, so
  `redact()` is best-effort). Treat `NATIVE_AVAILABLE == False` in production as
  an alert, not a shrug.
- **No per-pattern metrics.** `Verdict` reports categories, but nothing counts
  hits over time. If you want a moderation dashboard, aggregate
  `verdict.categories` in Python — and keep aggregating *categories*, not text,
  or you have quietly rebuilt the chat log you promised not to keep.
